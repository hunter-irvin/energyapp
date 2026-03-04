const crypto = require("crypto");
const { resolveRollingWindow } = require("./weather-sync");
const { resolveProviderMetadata } = require("../rates/provider-resolver");
const { getLmpSeries } = require("../rates/lmp-adapters");
const { getTariffSeries } = require("../rates/tariff-adapters");

const RATE_CLASS_CONFIGS = [
  { key: "lmp_da", serviceType: "lmp", marketMode: "day_ahead", resolutionMinutes: 60 },
  { key: "lmp_rt", serviceType: "lmp", marketMode: "real_time", resolutionMinutes: 5 },
  { key: "tariff", serviceType: "tariff", marketMode: "tariff", resolutionMinutes: 60 },
];

const toIso = (value) => {
  if (!value) return null;
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return null;
  return ts.toISOString();
};

const resolveWindow = ({ mode = "rolling", nowIso, windowStart, windowEnd }) => {
  if (mode === "rolling" || mode === "full") {
    return resolveRollingWindow(nowIso);
  }
  const explicitStart = toIso(windowStart);
  const explicitEnd = toIso(windowEnd);
  if (!explicitStart || !explicitEnd || explicitStart > explicitEnd) {
    return resolveRollingWindow(nowIso);
  }
  return {
    startIso: explicitStart,
    endIso: explicitEnd,
  };
};

const hashFingerprint = (value) => crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");

const inferPointStatus = ({ ts, hasValue }) => {
  if (!hasValue) return "provisional";
  const ageMs = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "provisional";
  return ageMs >= 3 * 24 * 60 * 60 * 1000 ? "final" : "provisional";
};

const normalizeRows = ({
  projectId,
  regionId,
  serviceType,
  marketMode,
  series,
  nowIso,
  ratesFingerprint,
}) => {
  const points = Array.isArray(series?.points) ? series.points : [];
  const source = series?.source || null;
  const sourceUrl = String(series?.details?.sourceUrl || "");
  const qualityStatus = String(series?.details?.reason || "").toLowerCase() === "source_unavailable" ? "missing" : "partial";
  const upstreamErrorCode = series?.details?.upstreamErrorCode || null;
  const resolutionMinutes = Number(series?.resolutionMinutes) || (serviceType === "lmp" && marketMode === "real_time" ? 5 : 60);

  return points
    .map((point) => {
      const ts = toIso(point?.ts);
      if (!ts) return null;
      const hasValue = Number.isFinite(Number(point?.value));
      const status = inferPointStatus({ ts, hasValue });
      return {
        project_id: projectId,
        region_id: regionId,
        service_type: serviceType,
        market_mode: marketMode,
        ts,
        resolution_minutes: resolutionMinutes,
        value: hasValue ? Number(point.value) : null,
        is_forecast: Boolean(point?.isForecast),
        is_modeled: false,
        source,
        source_url: sourceUrl || null,
        status,
        finalized_at: status === "final" ? nowIso : null,
        rates_source_fingerprint: ratesFingerprint,
        quality_status: hasValue ? qualityStatus : "missing",
        error_code: hasValue ? null : upstreamErrorCode,
        updated_at: nowIso,
      };
    })
    .filter(Boolean);
};

const enumerateExpectedTimestamps = ({ startIso, endIso, resolutionMinutes }) => {
  const out = [];
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return out;
  const stepMs = Math.max(1, Number(resolutionMinutes) || 60) * 60 * 1000;
  for (let cursor = startMs; cursor <= endMs; cursor += stepMs) {
    out.push(new Date(cursor).toISOString());
  }
  return out;
};

const buildMissingRanges = ({ expectedTs = [], availableTsSet = new Set(), resolutionMinutes }) => {
  const ranges = [];
  let currentStart = null;
  let previousMissingTs = null;
  const stepMs = Math.max(1, Number(resolutionMinutes) || 60) * 60 * 1000;

  for (let i = 0; i < expectedTs.length; i += 1) {
    const ts = expectedTs[i];
    const present = availableTsSet.has(ts);
    if (!present) {
      if (!currentStart) {
        currentStart = ts;
      }
      previousMissingTs = ts;
      continue;
    }

    if (currentStart) {
      ranges.push({
        startIso: currentStart,
        endIso: previousMissingTs || currentStart,
        expectedPoints: Math.max(
          1,
          Math.floor((new Date(previousMissingTs || currentStart).getTime() - new Date(currentStart).getTime()) / stepMs) + 1
        ),
      });
      currentStart = null;
      previousMissingTs = null;
    }
  }

  if (currentStart) {
    ranges.push({
      startIso: currentStart,
      endIso: previousMissingTs || currentStart,
      expectedPoints: Math.max(
        1,
        Math.floor((new Date(previousMissingTs || currentStart).getTime() - new Date(currentStart).getTime()) / stepMs) + 1
      ),
    });
  }

  return ranges;
};

const buildDbFirstRatesPlan = async ({ projectId, windowStart, windowEnd, store }) => {
  const classPlans = [];

  for (const config of RATE_CLASS_CONFIGS) {
    let existingRows = [];
    if (typeof store?.readRateSeriesWindow === "function") {
      // eslint-disable-next-line no-await-in-loop
      existingRows = await store.readRateSeriesWindow({
        projectId,
        serviceType: config.serviceType,
        marketMode: config.marketMode,
        windowStart,
        windowEnd,
        resolutionMinutes: config.resolutionMinutes,
      });
    }

    const expectedTs = enumerateExpectedTimestamps({
      startIso: windowStart,
      endIso: windowEnd,
      resolutionMinutes: config.resolutionMinutes,
    });
    const availableTsSet = new Set(
      (Array.isArray(existingRows) ? existingRows : [])
        .filter((row) => row?.value != null && row?.value !== "" && Number.isFinite(Number(row?.value)))
        .map((row) => toIso(row?.ts))
        .filter((ts) => Boolean(ts) && ts >= windowStart && ts <= windowEnd)
    );

    const expectedPoints = expectedTs.length;
    const availablePoints = Math.min(expectedPoints, availableTsSet.size);
    const missingPoints = Math.max(0, expectedPoints - availablePoints);
    const coveragePct = expectedPoints > 0 ? Number(((availablePoints / expectedPoints) * 100).toFixed(2)) : 0;
    const missingRanges = buildMissingRanges({
      expectedTs,
      availableTsSet,
      resolutionMinutes: config.resolutionMinutes,
    });

    classPlans.push({
      key: config.key,
      serviceType: config.serviceType,
      marketMode: config.marketMode,
      resolutionMinutes: config.resolutionMinutes,
      windowStart,
      windowEnd,
      expectedPoints,
      availablePoints,
      missingPoints,
      coveragePct,
      missingRanges,
      needsFetch: missingRanges.length > 0,
    });
  }

  const overall = classPlans.reduce(
    (acc, entry) => {
      acc.expectedPoints += entry.expectedPoints;
      acc.availablePoints += entry.availablePoints;
      acc.missingPoints += entry.missingPoints;
      return acc;
    },
    { expectedPoints: 0, availablePoints: 0, missingPoints: 0 }
  );
  overall.coveragePct =
    overall.expectedPoints > 0 ? Number(((overall.availablePoints / overall.expectedPoints) * 100).toFixed(2)) : 0;

  return {
    windowStart,
    windowEnd,
    classes: classPlans,
    overall,
    hasMissingData: classPlans.some((entry) => entry.needsFetch),
  };
};

const fetchClassRangeSeries = async ({
  classPlan,
  range,
  regionId,
  lat,
  lng,
  utilityCode,
  tariffProgramId,
  fetchLmpSeries,
  fetchTariffSeries,
  syncMode,
}) => {
  const start = new Date(range.startIso);
  const end = new Date(range.endIso);

  if (classPlan.serviceType === "tariff") {
    return fetchTariffSeries({
      regionId,
      start,
      end,
      tariffProgramId,
    });
  }

  return fetchLmpSeries({
    regionId,
    marketMode: classPlan.marketMode,
    start,
    end,
    lat,
    lng,
    utilityCode,
    chunkProfile: syncMode === "visible_window" ? "visible_window" : "backfill",
  });
};

const toChunkRow = ({ jobId, projectId, classPlan, range, nowIso, patch = {} }) => ({
  job_id: jobId || null,
  project_id: projectId,
  service_type: classPlan.serviceType,
  market_mode: classPlan.marketMode,
  resolution_minutes: classPlan.resolutionMinutes,
  chunk_start: range.startIso,
  chunk_end: range.endIso,
  expected_points: Number(range.expectedPoints || 0),
  completed_points: Number(patch.completed_points || 0),
  status: patch.status || "queued",
  error: patch.error || null,
  started_at: patch.started_at || null,
  completed_at: patch.completed_at || null,
  created_at: patch.created_at || nowIso,
  updated_at: patch.updated_at || nowIso,
});

const runRatesSync = async ({
  project,
  mode = "rolling",
  windowStart = null,
  windowEnd = null,
  requestedBy = "manual_refresh",
  now = () => new Date().toISOString(),
  store,
  jobId = null,
  enqueueJob,
  resolveProvider = resolveProviderMetadata,
  fetchLmpSeries = getLmpSeries,
  fetchTariffSeries = getTariffSeries,
} = {}) => {
  if (!project?.id) throw new Error("Rates sync requires project.");
  if (!store?.upsertRateSeriesRows || !store?.deleteRateSeriesOutsideWindow) {
    throw new Error("Rates sync requires rate series store methods.");
  }
  const lat = Number(project.location_lat ?? project.lat);
  const lng = Number(project.location_lng ?? project.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Rates sync requires project latitude/longitude.");
  }

  const nowIso = now();
  const { startIso, endIso } = resolveWindow({
    mode,
    nowIso,
    windowStart,
    windowEnd,
  });

  const provider = await resolveProvider({ lat, lng });
  const regionId = String(provider?.isoRegion || project.iso_region || "NON-ISO");
  const utilityCode = String(provider?.utilityCode || "");
  const tariffProgramId = String(provider?.tariffProgramId || "");

  const plan = await buildDbFirstRatesPlan({
    projectId: project.id,
    windowStart: startIso,
    windowEnd: endIso,
    store,
  });

  if (typeof store.upsertRateSyncChunks === "function") {
    const queuedRows = [];
    plan.classes.forEach((classPlan) => {
      classPlan.missingRanges.forEach((range) => {
        queuedRows.push(
          toChunkRow({
            jobId,
            projectId: project.id,
            classPlan,
            range,
            nowIso,
            patch: {
              status: "queued",
              created_at: nowIso,
              updated_at: nowIso,
            },
          })
        );
      });
    });
    await store.upsertRateSyncChunks(queuedRows);
  }

  const ratesFingerprint = hashFingerprint({
    projectId: project.id,
    regionId,
    windowStart: startIso,
    windowEnd: endIso,
    planSummary: plan.classes.map((entry) => ({
      key: entry.key,
      expectedPoints: entry.expectedPoints,
      availablePoints: entry.availablePoints,
      missingPoints: entry.missingPoints,
      rangeCount: entry.missingRanges.length,
    })),
    nowIso,
  });

  let upsertedRowCount = 0;

  for (const classPlan of plan.classes) {
    if (!classPlan.needsFetch) continue;
    for (const range of classPlan.missingRanges) {
      const chunkStartIso = now();
      if (typeof store.upsertRateSyncChunks === "function") {
        await store.upsertRateSyncChunks([
          toChunkRow({
            jobId,
            projectId: project.id,
            classPlan,
            range,
            nowIso,
            patch: {
              status: "running",
              started_at: chunkStartIso,
              updated_at: chunkStartIso,
            },
          }),
        ]);
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const series = await fetchClassRangeSeries({
          classPlan,
          range,
          regionId,
          lat,
          lng,
          utilityCode,
          tariffProgramId,
          fetchLmpSeries,
          fetchTariffSeries,
          syncMode: mode,
        });

        const chunkRows = normalizeRows({
          projectId: project.id,
          regionId,
          serviceType: classPlan.serviceType,
          marketMode: classPlan.marketMode,
          series,
          nowIso,
          ratesFingerprint,
        });

        // Persist each chunk immediately so charts/status can reflect partial progress.
        // eslint-disable-next-line no-await-in-loop
        await store.upsertRateSeriesRows(chunkRows);
        upsertedRowCount += chunkRows.length;

        const completedIso = now();
        if (typeof store.upsertRateSyncChunks === "function") {
          await store.upsertRateSyncChunks([
            toChunkRow({
              jobId,
              projectId: project.id,
              classPlan,
              range,
              nowIso,
              patch: {
                status: "completed",
                completed_points: chunkRows.length,
                completed_at: completedIso,
                updated_at: completedIso,
              },
            }),
          ]);
        }
      } catch (error) {
        const failedIso = now();
        if (typeof store.upsertRateSyncChunks === "function") {
          await store.upsertRateSyncChunks([
            toChunkRow({
              jobId,
              projectId: project.id,
              classPlan,
              range,
              nowIso,
              patch: {
                status: "failed",
                error: String(error?.message || "chunk_failed"),
                completed_at: failedIso,
                updated_at: failedIso,
              },
            }),
          ]);
        }
        throw error;
      }
    }
  }

  if (mode !== "visible_window") {
    await Promise.all([
      store.deleteRateSeriesOutsideWindow({
        projectId: project.id,
        regionId,
        serviceType: "lmp",
        marketMode: "day_ahead",
        windowStart: startIso,
        windowEnd: endIso,
      }),
      store.deleteRateSeriesOutsideWindow({
        projectId: project.id,
        regionId,
        serviceType: "lmp",
        marketMode: "real_time",
        windowStart: startIso,
        windowEnd: endIso,
      }),
      store.deleteRateSeriesOutsideWindow({
        projectId: project.id,
        regionId,
        serviceType: "tariff",
        marketMode: "tariff",
        windowStart: startIso,
        windowEnd: endIso,
      }),
    ]);
  }

  if (store.updateProjectRatesFingerprint) {
    await store.updateProjectRatesFingerprint(project.id, ratesFingerprint);
  }

  let backgroundEnqueued = false;
  if (mode === "visible_window" && typeof enqueueJob === "function") {
    const enqueueResult = await enqueueJob({
      projectId: project.id,
      domain: "rates",
      mode: "rolling",
      requestedBy,
      priority: 180,
      payload: { source: "visible_window_backfill" },
    });
    backgroundEnqueued = Boolean(enqueueResult && !enqueueResult.deduped);
  }

  let chunkRows = [];
  if (typeof store.listRateSyncChunks === "function") {
    chunkRows = await store.listRateSyncChunks({ projectId: project.id, jobId });
  }

  return {
    fingerprint: ratesFingerprint,
    regionId,
    windowStart: startIso,
    windowEnd: endIso,
    rowCount: upsertedRowCount,
    dbCoverage: plan,
    fetchedChunkCount: plan.classes.reduce((sum, entry) => sum + entry.missingRanges.length, 0),
    chunks: chunkRows,
    backgroundEnqueued,
  };
};

module.exports = {
  RATE_CLASS_CONFIGS,
  buildDbFirstRatesPlan,
  runRatesSync,
};


