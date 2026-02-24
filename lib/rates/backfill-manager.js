const { resolveProviderMetadata } = require("./provider-resolver");
const { getLmpSeries } = require("./lmp-adapters");
const { getTariffSeries } = require("./tariff-adapters");
const rateStore = require("./project-rate-store");

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_START_ISO = "2025-01-01T00:00:00.000Z";
const FINALIZATION_POLICY = Object.freeze({
  real_time: { provisionalDays: 7, stableDays: 7 },
  day_ahead: { provisionalDays: 3, stableDays: 3 },
  tariff: { provisionalDays: 0, stableDays: 0 },
});

const jobs = new Map();

const buildChunks = ({ start, end, days = 14 }) => {
  const chunks = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(Math.min(end.getTime(), chunkStart.getTime() + days * DAY_MS));
    chunks.push({ start: chunkStart, end: chunkEnd });
    cursor = new Date(chunkEnd.getTime() + 60 * 1000);
  }
  return chunks;
};

const inferPointStatus = ({ marketMode, ts }) => {
  const policy = FINALIZATION_POLICY[marketMode] || FINALIZATION_POLICY.day_ahead;
  const ageDays = (Date.now() - new Date(ts).getTime()) / DAY_MS;
  if (ageDays >= policy.stableDays) return "final";
  return "provisional";
};

const toRateStoreRows = ({
  projectId,
  regionId,
  serviceType,
  marketMode,
  source,
  sourceUrl,
  points = [],
  resolutionMinutes = 60,
}) =>
  points.map((point) => ({
    projectId,
    regionId,
    serviceType,
    marketMode,
    ts: point.ts,
    resolutionMinutes,
    value: point.value == null ? null : Number(point.value),
    isForecast: Boolean(point.isForecast),
    isModeled: point?.missingReason === "modeled_backfill",
    source,
    sourceUrl,
    status: inferPointStatus({ marketMode, ts: point.ts }),
    finalizedAt: inferPointStatus({ marketMode, ts: point.ts }) === "final" ? new Date().toISOString() : null,
  }));

const expandHourlyToQuarterHour = (points = []) => {
  const out = [];
  points.forEach((point) => {
    const base = new Date(point.ts);
    if (Number.isNaN(base.getTime())) return;
    for (let i = 0; i < 4; i += 1) {
      const ts = new Date(base.getTime() + i * 15 * 60 * 1000).toISOString();
      out.push({
        ...point,
        ts,
      });
    }
  });
  return out;
};

const buildTasks = ({ start, end }) => {
  const chunks = buildChunks({ start, end, days: 14 });
  const tasks = [];
  chunks.forEach((chunk) => {
    tasks.push({ serviceType: "tariff", marketMode: "tariff", chunk });
    tasks.push({ serviceType: "lmp", marketMode: "day_ahead", chunk });
    tasks.push({ serviceType: "lmp", marketMode: "real_time", chunk });
  });
  return tasks;
};

const updateJob = async (job, patch = {}) => {
  const merged = { ...job, ...patch };
  merged.updatedAt = new Date().toISOString();
  jobs.set(job.projectId, merged);
  await rateStore.upsertBackfillJob({
    projectId: merged.projectId,
    status: merged.status,
    lat: merged.lat,
    lng: merged.lng,
    regionId: merged.regionId,
    backfillStart: merged.backfillStart,
    backfillEnd: merged.backfillEnd,
    totalTasks: merged.totalTasks,
    completedTasks: merged.completedTasks,
    progressPct: merged.progressPct,
    startedAt: merged.startedAt,
    completedAt: merged.completedAt,
    error: merged.error || null,
    details: merged.details || {},
  }).catch(() => {});
  return merged;
};

const runJob = async (job) => {
  const provider = await resolveProviderMetadata({ lat: job.lat, lng: job.lng });
  await updateJob(job, {
    status: "running",
    startedAt: new Date().toISOString(),
    regionId: provider.isoRegion,
    details: {
      ...job.details,
      finalizationPolicy: FINALIZATION_POLICY,
      locationPolicy: {
        caiso: "nearest_hub_inferred_by_project_lat_lng",
        ercot: "settlement_point_inferred_by_utility_and_project_lat_lng",
      },
    },
  });
  const runningJob = jobs.get(job.projectId) || job;

  const tasks = buildTasks({ start: new Date(job.backfillStart), end: new Date(job.backfillEnd) });
  await updateJob(runningJob, { totalTasks: tasks.length, completedTasks: 0, progressPct: 0 });

  for (let i = 0; i < tasks.length; i += 1) {
    const current = jobs.get(job.projectId);
    if (!current || current.status === "cancelled") return;
    const task = tasks[i];
    const { serviceType, marketMode, chunk } = task;
    try {
      const series =
        serviceType === "tariff"
          ? // eslint-disable-next-line no-await-in-loop
            await getTariffSeries({
              regionId: provider.isoRegion,
              start: chunk.start,
              end: chunk.end,
              tariffProgramId: provider.tariffProgramId,
            })
          : // eslint-disable-next-line no-await-in-loop
            await getLmpSeries({
              regionId: provider.isoRegion,
              marketMode,
              start: chunk.start,
              end: chunk.end,
              lat: job.lat,
              lng: job.lng,
              utilityCode: provider.utilityCode,
            });
      const source = series?.source || null;
      const sourceUrl = series?.details?.sourceUrl || null;
      const basePoints = Array.isArray(series?.points) ? series.points : [];
      const storedPoints =
        serviceType === "lmp" && marketMode === "real_time"
          ? expandHourlyToQuarterHour(basePoints)
          : basePoints;
      const resolutionMinutes = serviceType === "lmp" && marketMode === "real_time" ? 15 : 60;
      const rows = toRateStoreRows({
        projectId: job.projectId,
        regionId: provider.isoRegion,
        serviceType,
        marketMode,
        source,
        sourceUrl,
        points: storedPoints,
        resolutionMinutes,
      });
      // eslint-disable-next-line no-await-in-loop
      await rateStore.upsertRatePoints(rows);
    } catch (error) {
      const next = jobs.get(job.projectId);
      await updateJob(next || job, {
        details: {
          ...(next?.details || {}),
          lastError: String(error?.message || "backfill_task_failed"),
          lastErrorTask: {
            serviceType: task.serviceType,
            marketMode: task.marketMode,
            start: task.chunk.start.toISOString(),
            end: task.chunk.end.toISOString(),
          },
        },
      });
    }
    const next = jobs.get(job.projectId) || job;
    const completedTasks = Number(next.completedTasks || 0) + 1;
    const totalTasks = Number(next.totalTasks || tasks.length);
    const progressPct = Math.max(0, Math.min(100, Math.round((completedTasks / totalTasks) * 100)));
    await updateJob(next, { completedTasks, progressPct });
  }

  const next = jobs.get(job.projectId) || job;
  await updateJob(next, {
    status: "completed",
    progressPct: 100,
    completedAt: new Date().toISOString(),
  });
};

const startBackfillJob = async ({ projectId, lat, lng, force = false }) => {
  if (!projectId || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    throw new Error("Missing required project/location for rates backfill.");
  }
  const existing = jobs.get(projectId);
  if (!force && existing && ["queued", "running"].includes(existing.status)) {
    return existing;
  }
  const persisted = await rateStore.getBackfillJob(projectId).catch(() => null);
  if (!force && persisted && ["queued", "running"].includes(persisted.status)) {
    const resumed = {
      projectId,
      lat: Number(lat),
      lng: Number(lng),
      status: persisted.status,
      regionId: persisted.region_id || null,
      backfillStart: persisted.backfill_start || BACKFILL_START_ISO,
      backfillEnd: persisted.backfill_end || new Date().toISOString(),
      totalTasks: Number(persisted.total_tasks || 0),
      completedTasks: Number(persisted.completed_tasks || 0),
      progressPct: Number(persisted.progress_pct || 0),
      startedAt: persisted.started_at || null,
      completedAt: persisted.completed_at || null,
      updatedAt: persisted.updated_at || new Date().toISOString(),
      error: persisted.error || null,
      details: persisted.details || {},
    };
    jobs.set(projectId, resumed);
    return resumed;
  }

  const job = {
    projectId,
    lat: Number(lat),
    lng: Number(lng),
    status: "queued",
    regionId: null,
    backfillStart: BACKFILL_START_ISO,
    backfillEnd: new Date().toISOString(),
    totalTasks: 0,
    completedTasks: 0,
    progressPct: 0,
    startedAt: null,
    completedAt: null,
    updatedAt: new Date().toISOString(),
    error: null,
    details: {
      finalizationPolicy: FINALIZATION_POLICY,
    },
  };
  jobs.set(projectId, job);
  await updateJob(job, {});
  runJob(job).catch(async (error) => {
    const next = jobs.get(projectId) || job;
    await updateJob(next, {
      status: "failed",
      error: String(error?.message || "backfill_failed"),
      completedAt: new Date().toISOString(),
      details: {
        ...(next.details || {}),
        fatalError: String(error?.message || "backfill_failed"),
      },
    });
  });
  return job;
};

const getBackfillJobStatus = async (projectId) => {
  const inMemory = jobs.get(projectId);
  if (inMemory) return inMemory;
  const persisted = await rateStore.getBackfillJob(projectId).catch(() => null);
  if (!persisted) return null;
  return {
    projectId,
    status: persisted.status || "idle",
    lat: persisted.lat,
    lng: persisted.lng,
    regionId: persisted.region_id || null,
    backfillStart: persisted.backfill_start || null,
    backfillEnd: persisted.backfill_end || null,
    totalTasks: Number(persisted.total_tasks || 0),
    completedTasks: Number(persisted.completed_tasks || 0),
    progressPct: Number(persisted.progress_pct || 0),
    startedAt: persisted.started_at || null,
    completedAt: persisted.completed_at || null,
    updatedAt: persisted.updated_at || null,
    error: persisted.error || null,
    details: persisted.details || {},
  };
};

module.exports = {
  BACKFILL_START_ISO,
  FINALIZATION_POLICY,
  startBackfillJob,
  getBackfillJobStatus,
};
