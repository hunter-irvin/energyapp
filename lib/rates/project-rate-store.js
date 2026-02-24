const { URL } = require("url");

const SUPABASE_URL = process.env.ENERGYAPP_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.ENERGYAPP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const REST_BASE = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1` : "";
const HAS_SUPABASE = Boolean(REST_BASE && SUPABASE_ANON_KEY);

const localState = {
  ratePoints: [],
  jobs: new Map(),
};

const toIso = (value) => {
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return null;
  return ts.toISOString();
};

const defaultHeaders = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
});

const rest = async ({ method = "GET", table, searchParams = null, body = null, headers = {}, range = null }) => {
  const url = new URL(`${REST_BASE}/${table}`);
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value == null || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }
  const response = await fetch(url.toString(), {
    method,
    headers: {
      ...defaultHeaders(),
      ...headers,
      ...(range ? { Range: range } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.message || payload?.error_description || `Supabase REST ${response.status}`;
    throw new Error(message);
  }
  return payload;
};

const upsertRatePointsLocal = async (rows = []) => {
  const next = localState.ratePoints.slice();
  rows.forEach((row) => {
    const ts = toIso(row.ts);
    if (!ts) return;
    const key = `${row.project_id}|${row.region_id}|${row.service_type}|${row.market_mode}|${row.resolution_minutes}|${ts}`;
    const index = next.findIndex(
      (entry) =>
        `${entry.project_id}|${entry.region_id}|${entry.service_type}|${entry.market_mode}|${entry.resolution_minutes}|${entry.ts}` === key
    );
    const normalized = {
      ...row,
      ts,
      updated_at: new Date().toISOString(),
    };
    if (index >= 0) next[index] = { ...next[index], ...normalized };
    else next.push(normalized);
  });
  localState.ratePoints = next;
  return true;
};

const listRatePointsLocal = async ({
  projectId,
  regionId,
  serviceType,
  marketMode,
  start,
  end,
  resolutionMinutes,
}) =>
  localState.ratePoints
    .filter((row) => {
      if (projectId && row.project_id !== projectId) return false;
      if (regionId && row.region_id !== regionId) return false;
      if (serviceType && row.service_type !== serviceType) return false;
      if (marketMode && row.market_mode !== marketMode) return false;
      if (resolutionMinutes != null && Number(row.resolution_minutes) !== Number(resolutionMinutes)) return false;
      if (start && new Date(row.ts).getTime() < new Date(start).getTime()) return false;
      if (end && new Date(row.ts).getTime() > new Date(end).getTime()) return false;
      return true;
    })
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

const upsertJobLocal = async (row) => {
  localState.jobs.set(String(row.project_id), { ...row, updated_at: new Date().toISOString() });
  return localState.jobs.get(String(row.project_id));
};

const getJobLocal = async (projectId) => localState.jobs.get(String(projectId)) || null;

const upsertRatePoints = async (rows = []) => {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      project_id: row.projectId,
      region_id: row.regionId,
      service_type: row.serviceType,
      market_mode: row.marketMode,
      ts: toIso(row.ts),
      resolution_minutes: Number(row.resolutionMinutes || 60),
      value: row.value == null ? null : Number(row.value),
      is_forecast: Boolean(row.isForecast),
      is_modeled: Boolean(row.isModeled),
      source: row.source || null,
      source_url: row.sourceUrl || null,
      status: row.status || "provisional",
      finalized_at: row.finalizedAt || null,
      updated_at: new Date().toISOString(),
    }))
    .filter((row) => row.project_id && row.region_id && row.service_type && row.market_mode && row.ts);
  if (!normalized.length) return true;
  if (!HAS_SUPABASE) return upsertRatePointsLocal(normalized);

  const batchSize = 500;
  for (let i = 0; i < normalized.length; i += batchSize) {
    // eslint-disable-next-line no-await-in-loop
    await rest({
      method: "POST",
      table: "rate_project_series",
      searchParams: {
        on_conflict: "project_id,region_id,service_type,market_mode,resolution_minutes,ts",
      },
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: normalized.slice(i, i + batchSize),
    });
  }
  return true;
};

const listRatePoints = async (options = {}) => {
  const { projectId, regionId, serviceType, marketMode, start, end, resolutionMinutes = null } = options;
  if (!HAS_SUPABASE) {
    return listRatePointsLocal({ projectId, regionId, serviceType, marketMode, start, end, resolutionMinutes });
  }

  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const data = await rest({
      method: "GET",
      table: "rate_project_series",
      searchParams: {
        select: "project_id,region_id,service_type,market_mode,ts,resolution_minutes,value,is_forecast,is_modeled,source,source_url,status,finalized_at",
        project_id: projectId ? `eq.${projectId}` : null,
        region_id: regionId ? `eq.${regionId}` : null,
        service_type: serviceType ? `eq.${serviceType}` : null,
        market_mode: marketMode ? `eq.${marketMode}` : null,
        ts: start ? `gte.${toIso(start)}` : null,
        order: "ts.asc",
      },
      range: `${offset}-${offset + pageSize - 1}`,
    });
    const batch = Array.isArray(data) ? data : [];
    const filtered = batch.filter((row) => {
      if (end && new Date(row.ts).getTime() > new Date(end).getTime()) return false;
      if (resolutionMinutes != null && Number(row.resolution_minutes) !== Number(resolutionMinutes)) return false;
      return true;
    });
    rows.push(...filtered);
    if (batch.length < pageSize) break;
  }
  return rows;
};

const upsertBackfillJob = async (job = {}) => {
  const row = {
    project_id: job.projectId,
    status: job.status || "queued",
    lat: Number(job.lat),
    lng: Number(job.lng),
    region_id: job.regionId || null,
    backfill_start: job.backfillStart || null,
    backfill_end: job.backfillEnd || null,
    total_tasks: Number(job.totalTasks || 0),
    completed_tasks: Number(job.completedTasks || 0),
    progress_pct: Number(job.progressPct || 0),
    started_at: job.startedAt || null,
    updated_at: new Date().toISOString(),
    completed_at: job.completedAt || null,
    error: job.error || null,
    details: job.details || {},
  };
  if (!HAS_SUPABASE) return upsertJobLocal(row);
  const data = await rest({
    method: "POST",
    table: "rate_backfill_jobs",
    searchParams: { on_conflict: "project_id", select: "*" },
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: [row],
  });
  return Array.isArray(data) && data.length ? data[0] : null;
};

const getBackfillJob = async (projectId) => {
  if (!projectId) return null;
  if (!HAS_SUPABASE) return getJobLocal(projectId);
  const data = await rest({
    method: "GET",
    table: "rate_backfill_jobs",
    searchParams: {
      select: "*",
      project_id: `eq.${projectId}`,
      limit: "1",
    },
  });
  return Array.isArray(data) && data.length ? data[0] : null;
};

module.exports = {
  hasSupabaseStore: () => HAS_SUPABASE,
  upsertRatePoints,
  listRatePoints,
  upsertBackfillJob,
  getBackfillJob,
};

