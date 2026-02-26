const { URL } = require("url");

const SUPABASE_URL = process.env.ENERGYAPP_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.ENERGYAPP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const REST_BASE = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1` : "";

const isConfigured = () => Boolean(REST_BASE && SUPABASE_ANON_KEY);

const getDefaultHeaders = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
});

const rest = async ({ method = "GET", table, searchParams = null, body = null, headers = {} }) => {
  const url = new URL(`${REST_BASE}/${table}`);
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value == null || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }
  const response = await fetch(url.toString(), {
    method,
    headers: { ...getDefaultHeaders(), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.message || payload?.error_description || `Supabase REST ${response.status}`;
    throw new Error(detail);
  }
  return payload;
};

const chunk = (values, size = 400) => {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
};

const createSupabaseIngestionJobStore = () => {
  if (!isConfigured()) {
    throw new Error("Supabase REST is not configured.");
  }

  return {
    async findActiveDuplicate({ projectId, domain, mode, windowStart, windowEnd }) {
      const rows = await rest({
        method: "GET",
        table: "ingestion_jobs",
        searchParams: {
          select: "*",
          project_id: `eq.${projectId}`,
          domain: `eq.${domain}`,
          mode: `eq.${mode}`,
          status: "in.(queued,running)",
          window_start: windowStart ? `eq.${windowStart}` : "is.null",
          window_end: windowEnd ? `eq.${windowEnd}` : "is.null",
          order: "created_at.desc",
          limit: "1",
        },
      });
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    async insert(row) {
      const rows = await rest({
        method: "POST",
        table: "ingestion_jobs",
        body: [row],
        headers: { Prefer: "return=representation" },
      });
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    async claim(jobId, nowIso) {
      const rows = await rest({
        method: "PATCH",
        table: "ingestion_jobs",
        searchParams: {
          id: `eq.${jobId}`,
          status: "eq.queued",
          select: "*",
        },
        headers: { Prefer: "return=representation" },
        body: {
          status: "running",
          started_at: nowIso,
          updated_at: nowIso,
        },
      });
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    async claimNextRunnable(nowIso) {
      const rows = await rest({
        method: "GET",
        table: "ingestion_jobs",
        searchParams: {
          select: "*",
          status: "eq.queued",
          or: `(next_retry_at.is.null,next_retry_at.lte.${nowIso})`,
          order: "priority.asc,created_at.asc",
          limit: "1",
        },
      });
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    async update(jobId, patch) {
      const rows = await rest({
        method: "PATCH",
        table: "ingestion_jobs",
        searchParams: {
          id: `eq.${jobId}`,
          select: "*",
        },
        headers: { Prefer: "return=representation" },
        body: patch,
      });
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    async upsertDomainSyncState(row) {
      const rows = await rest({
        method: "POST",
        table: "domain_sync_state",
        searchParams: { on_conflict: "project_id,domain", select: "*" },
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: [row],
      });
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    async upsertWeatherSeriesRows(rows = []) {
      if (!Array.isArray(rows) || !rows.length) return { count: 0 };
      const batches = chunk(rows, 400);
      for (const batch of batches) {
        // eslint-disable-next-line no-await-in-loop
        await rest({
          method: "POST",
          table: "weather_project_series",
          searchParams: {
            on_conflict: "project_id,provider,dataset,resolution_minutes,ts",
          },
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: batch,
        });
      }
      return { count: rows.length };
    },
    async deleteWeatherSeriesOutsideWindow({ projectId, provider, windowStart, windowEnd }) {
      await rest({
        method: "DELETE",
        table: "weather_project_series",
        searchParams: {
          project_id: `eq.${projectId}`,
          provider: provider ? `eq.${provider}` : null,
          ts: `lt.${windowStart}`,
        },
      });
      await rest({
        method: "DELETE",
        table: "weather_project_series",
        searchParams: {
          project_id: `eq.${projectId}`,
          provider: provider ? `eq.${provider}` : null,
          ts: `gt.${windowEnd}`,
        },
      });
      return true;
    },
    async updateProjectWeatherFingerprint(projectId, fingerprint) {
      await rest({
        method: "PATCH",
        table: "projects",
        searchParams: {
          id: `eq.${projectId}`,
        },
        body: {
          weather_fingerprint: fingerprint,
          updated_at: new Date().toISOString(),
        },
      });
      return true;
    },
    async upsertGenerationSeriesRows(rows = []) {
      if (!Array.isArray(rows) || !rows.length) return { count: 0 };
      const batches = chunk(rows, 400);
      for (const batch of batches) {
        // eslint-disable-next-line no-await-in-loop
        await rest({
          method: "POST",
          table: "generation_project_series",
          searchParams: {
            on_conflict: "project_id,resolution_minutes,ts",
          },
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: batch,
        });
      }
      return { count: rows.length };
    },
    async deleteGenerationSeriesOutsideWindow({ projectId, windowStart, windowEnd, resolutionMinutes }) {
      await rest({
        method: "DELETE",
        table: "generation_project_series",
        searchParams: {
          project_id: `eq.${projectId}`,
          resolution_minutes: resolutionMinutes ? `eq.${resolutionMinutes}` : null,
          ts: `lt.${windowStart}`,
        },
      });
      await rest({
        method: "DELETE",
        table: "generation_project_series",
        searchParams: {
          project_id: `eq.${projectId}`,
          resolution_minutes: resolutionMinutes ? `eq.${resolutionMinutes}` : null,
          ts: `gt.${windowEnd}`,
        },
      });
      return true;
    },
    async updateProjectGenerationFingerprints(projectId, { assetFingerprint, weatherFingerprint } = {}) {
      await rest({
        method: "PATCH",
        table: "projects",
        searchParams: {
          id: `eq.${projectId}`,
        },
        body: {
          asset_fingerprint: assetFingerprint || null,
          weather_fingerprint: weatherFingerprint || null,
          updated_at: new Date().toISOString(),
        },
      });
      return true;
    },
  };
};

module.exports = {
  createSupabaseIngestionJobStore,
  isSupabaseIngestionStoreConfigured: isConfigured,
};
