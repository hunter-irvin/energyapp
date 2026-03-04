const { URL } = require("url");
const { createIngestionJobEngine } = require("../lib/v3/ingestion-job-engine");
const { runWeatherSync } = require("../lib/v3/weather-sync");
const { runGenerationSync } = require("../lib/v3/generation-sync");
const { runRatesSync } = require("../lib/v3/rates-sync");
const { resolveInvalidationPlan } = require("../lib/v3/invalidation-rules");
const {
  createSupabaseIngestionJobStore,
  isSupabaseIngestionStoreConfigured,
} = require("../lib/v3/ingestion-job-store-supabase");
const { fetchAndNormalizeOpenMeteo, fetchAndNormalizeNrel } = require("./weather-proxy");

const SUPABASE_URL = process.env.ENERGYAPP_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.ENERGYAPP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const REST_BASE = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1` : "";
const VALID_DOMAINS = new Set(["weather", "generation", "rates", "storage"]);
const VALID_SYNC_MODES = new Set(["rolling", "full", "visible_window"]);
const VALID_REQUEST_SOURCES = new Set([
  "user_login",
  "manual_refresh",
  "nightly_cron",
  "location_change",
  "asset_change",
]);

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
};

const sendJsonError = (res, status, message) => sendJson(res, status, { errors: [String(message || "Request failed")] });

const toIso = (value) => {
  if (!value) return null;
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return null;
  return ts.toISOString();
};

const isSupabaseConfigured = () => Boolean(REST_BASE && SUPABASE_ANON_KEY) && isSupabaseIngestionStoreConfigured();

const getDefaultHeaders = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
});

const supabaseRest = async ({ method = "GET", table, searchParams = null, body = null, headers = {} }) => {
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

const supabaseCountRows = async ({ table, searchParams = null }) => {
  const url = new URL(`${REST_BASE}/${table}`);
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value == null || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }
  if (!url.searchParams.has("select")) {
    url.searchParams.set("select", "id");
  }
  if (!url.searchParams.has("limit")) {
    url.searchParams.set("limit", "1");
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      ...getDefaultHeaders(),
      Prefer: "count=exact",
      Range: "0-0",
    },
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

  const contentRange = response.headers.get("content-range") || "";
  const match = contentRange.match(/\/(\d+)$/);
  if (match) return Number(match[1] || 0);
  if (Array.isArray(payload)) return payload.length;
  return Number(payload?.count || 0) || 0;
};

const readJsonBody = async (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });

const parseDomainFromPath = (req) => {
  const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 4) return "";
  if (parts[0] !== "api" || parts[1] !== "v3" || parts[2] !== "sync") return "";
  return String(parts[3] || "").trim().toLowerCase();
};

const parseV3Query = (req) => new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams;

const requireSupabase = (res) => {
  if (isSupabaseConfigured()) return true;
  sendJsonError(res, 503, "Supabase backend unavailable for v3 API.");
  return false;
};

const resolveWeatherFetcher = async ({ provider, lat, lng, startDate, endDate }) => {
  if (provider === "nrel") {
    return fetchAndNormalizeNrel({ lat, lng });
  }
  return fetchAndNormalizeOpenMeteo({ lat, lng, startDate, endDate });
};

const createWeatherDomainHandler = (store) => async (job) => {
  const rows = await supabaseRest({
    method: "GET",
    table: "projects",
    searchParams: {
      select: "id,location_lat,location_lng,weather_provider",
      id: `eq.${job.project_id}`,
      limit: "1",
    },
  });
  const project = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!project) throw new Error("Project not found for weather sync.");
  return runWeatherSync({
    project,
    mode: job.mode,
    windowStart: job.window_start,
    windowEnd: job.window_end,
    fetchWeather: resolveWeatherFetcher,
    store,
  });
};

const createGenerationDomainHandler = (store) => async (job, helper = {}) => {
  const projectRows = await supabaseRest({
    method: "GET",
    table: "projects",
    searchParams: {
      select: "id,location_lat,location_lng,weather_provider",
      id: `eq.${job.project_id}`,
      limit: "1",
    },
  });
  const project = Array.isArray(projectRows) && projectRows.length ? projectRows[0] : null;
  if (!project) throw new Error("Project not found for generation sync.");

  return runGenerationSync({
    project,
    mode: job.mode,
    windowStart: job.window_start,
    windowEnd: job.window_end,
    requestedBy: job.requested_by,
    readAssets: async (projectId) => {
      const assetRows = await supabaseRest({
        method: "GET",
        table: "assets",
        searchParams: {
          select: "asset_type,model",
          project_id: `eq.${projectId}`,
          order: "created_at.asc",
        },
      });
      return Array.isArray(assetRows) ? assetRows : [];
    },
    readWeatherSeries: async ({ projectId, startIso, endIso, resolutionMinutes, provider }) => {
      const weatherRows = await supabaseRest({
        method: "GET",
        table: "weather_project_series",
        searchParams: {
          select: "dataset,ts,is_forecast,metrics,weather_fingerprint,provider",
          project_id: `eq.${projectId}`,
          provider: provider ? `eq.${provider}` : null,
          resolution_minutes: `eq.${resolutionMinutes}`,
          ts: `gte.${startIso}`,
          order: "ts.asc",
        },
      });
      return (Array.isArray(weatherRows) ? weatherRows : []).filter((row) => String(row.ts || "") <= endIso);
    },
    store,
    enqueueJob: helper.enqueue,
  });
};

const createRatesDomainHandler = (store) => async (job, helper = {}) => {
  const projectRows = await supabaseRest({
    method: "GET",
    table: "projects",
    searchParams: {
      select: "id,location_lat,location_lng,iso_region,utility_name",
      id: `eq.${job.project_id}`,
      limit: "1",
    },
  });
  const project = Array.isArray(projectRows) && projectRows.length ? projectRows[0] : null;
  if (!project) throw new Error("Project not found for rates sync.");

  return runRatesSync({
    project,
    mode: job.mode,
    windowStart: job.window_start,
    windowEnd: job.window_end,
    requestedBy: job.requested_by,
    store,
    jobId: job.id || null,
    enqueueJob: helper.enqueue,
  });
};

const createEngine = () => {
  const store = createSupabaseIngestionJobStore();
  return createIngestionJobEngine({
    store,
    handlers: {
      weather: createWeatherDomainHandler(store),
      generation: createGenerationDomainHandler(store),
      rates: createRatesDomainHandler(store),
      storage: async () => ({ fingerprint: null }),
    },
  });
};

const handleV3SyncDomain = async (req, res) => {
  if (req.method !== "POST") {
    sendJsonError(res, 405, "Method not allowed.");
    return;
  }
  if (!requireSupabase(res)) return;

  const domain = parseDomainFromPath(req);
  if (!VALID_DOMAINS.has(domain)) {
    sendJsonError(res, 400, "Invalid domain.");
    return;
  }

  const body = await readJsonBody(req);
  if (body == null) {
    sendJsonError(res, 400, "Invalid JSON body.");
    return;
  }
  const projectId = String(body.projectId || "").trim();
  const mode = String(body.mode || "rolling").trim().toLowerCase();
  const requestedBy = String(body.reason || body.requestedBy || "manual_refresh").trim().toLowerCase();
  const windowStart = toIso(body.windowStart);
  const windowEnd = toIso(body.windowEnd);

  if (!projectId) {
    sendJsonError(res, 400, "Missing required projectId.");
    return;
  }
  if (!VALID_SYNC_MODES.has(mode)) {
    sendJsonError(res, 400, "Invalid sync mode.");
    return;
  }
  if (!VALID_REQUEST_SOURCES.has(requestedBy)) {
    sendJsonError(res, 400, "Invalid requestedBy/reason.");
    return;
  }

  try {
    const engine = createEngine();
    const { job, deduped } = await engine.enqueue({
      projectId,
      domain,
      mode,
      requestedBy,
      priority: Number(body.priority || 100),
      windowStart,
      windowEnd,
      payload: body.payload || {},
    });
    if (body.runNow === true) {
      await engine.runJob(job);
    }
    sendJson(res, 200, {
      ok: true,
      domain,
      projectId,
      jobId: job?.id || null,
      status: job?.status || "queued",
      queuedAt: job?.created_at || new Date().toISOString(),
      deduped,
    });
  } catch (error) {
    sendJsonError(res, 502, error.message || "Failed to enqueue sync job.");
  }
};

const resolveRatesResolutionMinutes = ({ serviceType, marketMode, requestedResolutionMinutes }) => {
  if (Number.isFinite(requestedResolutionMinutes) && requestedResolutionMinutes > 0) {
    return requestedResolutionMinutes;
  }
  if (serviceType === "lmp" && marketMode === "real_time") return 5;
  return 60;
};

const resolveExpectedPoints = ({ startIso, endIso, resolutionMinutes }) => {
  const startMs = Date.parse(String(startIso || ""));
  const endMs = Date.parse(String(endIso || ""));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  if (!Number.isFinite(resolutionMinutes) || resolutionMinutes <= 0) return 0;
  const intervalMs = resolutionMinutes * 60 * 1000;
  return Math.floor((endMs - startMs) / intervalMs) + 1;
};

const resolveCoverageMetrics = ({ expectedPoints, availablePoints }) => {
  const expected = Math.max(0, Number(expectedPoints) || 0);
  const available = Math.max(0, Number(availablePoints) || 0);
  const boundedAvailable = expected > 0 ? Math.min(available, expected) : available;
  const missing = Math.max(0, expected - boundedAvailable);
  const coveragePct = expected > 0 ? Number(((boundedAvailable / expected) * 100).toFixed(2)) : 0;
  let qualityStatus = "missing";
  if (expected > 0 && missing === 0 && boundedAvailable > 0) qualityStatus = "complete";
  else if (boundedAvailable > 0) qualityStatus = "partial";
  return {
    expectedPoints: expected,
    availablePoints: boundedAvailable,
    missingPoints: missing,
    coveragePct,
    qualityStatus,
  };
};

const countFiniteValueRows = (rows = []) =>
  (Array.isArray(rows) ? rows : []).reduce(
    (sum, row) => (row?.value != null && row?.value !== "" && Number.isFinite(Number(row?.value)) ? sum + 1 : sum),
    0
  );

const mapRateChunkClassKey = ({ serviceType, marketMode }) => {
  if (serviceType === "tariff" && marketMode === "tariff") return "tariff";
  if (serviceType === "lmp" && marketMode === "real_time") return "lmpRt";
  if (serviceType === "lmp" && marketMode === "day_ahead") return "lmpDa";
  return null;
};

const summarizeChunkRows = ({ rows = [], classConfigs = [] }) => {
  const byClass = {};
  classConfigs.forEach((cfg) => {
    byClass[cfg.key] = {
      totalChunks: 0,
      queuedChunks: 0,
      runningChunks: 0,
      completedChunks: 0,
      failedChunks: 0,
      chunkProgressPct: 0,
      activeChunk: null,
      failures: [],
    };
  });

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = mapRateChunkClassKey({
      serviceType: String(row?.service_type || "").toLowerCase(),
      marketMode: String(row?.market_mode || "").toLowerCase(),
    });
    if (!key || !byClass[key]) return;

    const target = byClass[key];
    target.totalChunks += 1;
    const status = String(row?.status || "queued").toLowerCase();
    if (status === "queued") target.queuedChunks += 1;
    if (status === "running") {
      target.runningChunks += 1;
      if (!target.activeChunk) {
        target.activeChunk = {
          windowStart: toIso(row?.chunk_start),
          windowEnd: toIso(row?.chunk_end),
          phase: "fetching",
        };
      }
    }
    if (status === "completed") target.completedChunks += 1;
    if (status === "failed") {
      target.failedChunks += 1;
      target.failures.push({
        chunkStart: toIso(row?.chunk_start),
        chunkEnd: toIso(row?.chunk_end),
        error: row?.error || null,
        updatedAt: toIso(row?.updated_at),
      });
    }
  });

  let overallTotal = 0;
  let overallCompleted = 0;
  let overallQueued = 0;
  let overallRunning = 0;
  let overallFailed = 0;

  classConfigs.forEach((cfg) => {
    const entry = byClass[cfg.key];
    entry.chunkProgressPct =
      entry.totalChunks > 0 ? Number(((entry.completedChunks / entry.totalChunks) * 100).toFixed(2)) : 0;
    overallTotal += entry.totalChunks;
    overallCompleted += entry.completedChunks;
    overallQueued += entry.queuedChunks;
    overallRunning += entry.runningChunks;
    overallFailed += entry.failedChunks;
  });

  return {
    byClass,
    overall: {
      totalChunks: overallTotal,
      queuedChunks: overallQueued,
      runningChunks: overallRunning,
      completedChunks: overallCompleted,
      failedChunks: overallFailed,
      chunkProgressPct: overallTotal > 0 ? Number(((overallCompleted / overallTotal) * 100).toFixed(2)) : 0,
    },
  };
};

const buildRatesStatusCoverage = async ({ projectId, query, latestJob }) => {
  const classConfigs = [
    { key: "tariff", serviceType: "tariff", marketMode: "tariff" },
    { key: "lmpRt", serviceType: "lmp", marketMode: "real_time" },
    { key: "lmpDa", serviceType: "lmp", marketMode: "day_ahead" },
  ];
  const resolutionParam = query.get("interval") || query.get("resolutionMinutes");
  const requestedResolutionMinutes = resolutionParam == null ? null : Number(resolutionParam);
  const windowStart = toIso(query.get("start")) || toIso(latestJob?.window_start);
  const windowEnd = toIso(query.get("end")) || toIso(latestJob?.window_end);
  const hasWindow = Boolean(windowStart && windowEnd && windowStart <= windowEnd);

  const byClass = {};
  if (!hasWindow) {
    classConfigs.forEach((config) => {
      byClass[config.key] = {
        serviceType: config.serviceType,
        marketMode: config.marketMode,
        windowStart: windowStart || null,
        windowEnd: windowEnd || null,
        expectedPoints: 0,
        availablePoints: 0,
        missingPoints: 0,
        coveragePct: 0,
        qualityStatus: "missing",
        totalChunks: 0,
        queuedChunks: 0,
        runningChunks: 0,
        completedChunks: 0,
        failedChunks: 0,
        chunkProgressPct: 0,
        activeChunk: null,
        failures: [],
      };
    });
    return {
      windowStart: windowStart || null,
      windowEnd: windowEnd || null,
      byClass,
      overall: {
        expectedPoints: 0,
        availablePoints: 0,
        missingPoints: 0,
        coveragePct: 0,
        qualityStatus: "missing",
        totalChunks: 0,
        queuedChunks: 0,
        runningChunks: 0,
        completedChunks: 0,
        failedChunks: 0,
        chunkProgressPct: 0,
      },
    };
  }

  let chunkRows = [];
  try {
    chunkRows = await supabaseRest({
      method: "GET",
      table: "rate_sync_chunks",
      searchParams: {
        select: "*",
        project_id: `eq.${projectId}`,
        job_id: latestJob?.id ? `eq.${latestJob.id}` : null,
        order: "updated_at.desc",
        limit: "5000",
      },
    });
  } catch (error) {
    chunkRows = [];
  }
  const chunkSummary = summarizeChunkRows({ rows: chunkRows, classConfigs });

  await Promise.all(
    classConfigs.map(async (config) => {
      const resolutionMinutes = resolveRatesResolutionMinutes({
        serviceType: config.serviceType,
        marketMode: config.marketMode,
        requestedResolutionMinutes,
      });
      const rows = await fetchAllRateSeriesRows({
        projectId,
        serviceType: config.serviceType,
        marketMode: config.marketMode,
        start: windowStart,
        end: windowEnd,
        resolutionMinutes: Number.isFinite(requestedResolutionMinutes) ? requestedResolutionMinutes : resolutionMinutes,
      });
      const expectedPoints = resolveExpectedPoints({
        startIso: windowStart,
        endIso: windowEnd,
        resolutionMinutes,
      });
      const metrics = resolveCoverageMetrics({
        expectedPoints,
        availablePoints: countFiniteValueRows(rows),
      });
      const chunkMetrics = chunkSummary.byClass[config.key] || {
        totalChunks: 0,
        queuedChunks: 0,
        runningChunks: 0,
        completedChunks: 0,
        failedChunks: 0,
        chunkProgressPct: 0,
        activeChunk: null,
        failures: [],
      };
      byClass[config.key] = {
        serviceType: config.serviceType,
        marketMode: config.marketMode,
        windowStart,
        windowEnd,
        ...metrics,
        ...chunkMetrics,
        activeChunk:
          chunkMetrics.activeChunk ||
          (latestJob?.status === "running"
            ? {
                windowStart,
                windowEnd,
                phase: "visible_window",
              }
            : null),
      };
    })
  );

  const overallExpectedPoints = classConfigs.reduce((sum, config) => sum + (byClass[config.key]?.expectedPoints || 0), 0);
  const overallAvailablePoints = classConfigs.reduce((sum, config) => sum + (byClass[config.key]?.availablePoints || 0), 0);
  const overallCoverage = resolveCoverageMetrics({
    expectedPoints: overallExpectedPoints,
    availablePoints: overallAvailablePoints,
  });

  return {
    windowStart,
    windowEnd,
    byClass,
    overall: {
      ...overallCoverage,
      ...chunkSummary.overall,
    },
  };
};

const buildDefaultRatesStatusCoverage = ({ latestJob = null, query = null } = {}) => {
  const windowStart = toIso(query?.get?.("start")) || toIso(latestJob?.window_start) || null;
  const windowEnd = toIso(query?.get?.("end")) || toIso(latestJob?.window_end) || null;
  const createClassEntry = (serviceType, marketMode) => ({
    serviceType,
    marketMode,
    windowStart,
    windowEnd,
    expectedPoints: 0,
    availablePoints: 0,
    missingPoints: 0,
    coveragePct: 0,
    qualityStatus: "missing",
    totalChunks: 0,
    queuedChunks: 0,
    runningChunks: 0,
    completedChunks: 0,
    failedChunks: 0,
    chunkProgressPct: 0,
    activeChunk: null,
    failures: [],
  });
  return {
    windowStart,
    windowEnd,
    byClass: {
      tariff: createClassEntry("tariff", "tariff"),
      lmpRt: createClassEntry("lmp", "real_time"),
      lmpDa: createClassEntry("lmp", "day_ahead"),
    },
    overall: {
      expectedPoints: 0,
      availablePoints: 0,
      missingPoints: 0,
      coveragePct: 0,
      qualityStatus: "missing",
      totalChunks: 0,
      queuedChunks: 0,
      runningChunks: 0,
      completedChunks: 0,
      failedChunks: 0,
      chunkProgressPct: 0,
    },
  };
};

const handleV3SyncStatus = async (req, res) => {
  if (req.method !== "GET") {
    sendJsonError(res, 405, "Method not allowed.");
    return;
  }
  if (!requireSupabase(res)) return;

  const domain = parseDomainFromPath(req);
  if (!VALID_DOMAINS.has(domain)) {
    sendJsonError(res, 400, "Invalid domain.");
    return;
  }
  const query = parseV3Query(req);
  const projectId = String(query.get("projectId") || "").trim();
  if (!projectId) {
    sendJsonError(res, 400, "Missing required projectId.");
    return;
  }

  try {
    const latestJobRows = await supabaseRest({
      method: "GET",
      table: "ingestion_jobs",
      searchParams: {
        select: "*",
        project_id: `eq.${projectId}`,
        domain: `eq.${domain}`,
        order: "created_at.desc",
        limit: "1",
      },
    });
    const syncStateRows = await supabaseRest({
      method: "GET",
      table: "domain_sync_state",
      searchParams: {
        select: "*",
        project_id: `eq.${projectId}`,
        domain: `eq.${domain}`,
        limit: "1",
      },
    });
    const latestJob = Array.isArray(latestJobRows) && latestJobRows.length ? latestJobRows[0] : null;
    const syncState = Array.isArray(syncStateRows) && syncStateRows.length ? syncStateRows[0] : null;
    let ratesProgress = null;
    if (domain === "rates") {
      try {
        ratesProgress = await buildRatesStatusCoverage({ projectId, query, latestJob });
      } catch (error) {
        ratesProgress = buildDefaultRatesStatusCoverage({ latestJob, query });
      }
    }
    sendJson(res, 200, {
      ok: true,
      projectId,
      domain,
      job: latestJob,
      syncState,
      progress: ratesProgress,
      coverage: ratesProgress,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    sendJsonError(res, 502, error.message || "Failed to fetch sync status.");
  }
};

const handleV3SeriesWeather = async (req, res) => {
  if (req.method !== "GET") {
    sendJsonError(res, 405, "Method not allowed.");
    return;
  }
  if (!requireSupabase(res)) return;

  const query = parseV3Query(req);
  const projectId = String(query.get("projectId") || "").trim();
  const dataset = String(query.get("dataset") || "").trim().toLowerCase();
  const provider = String(query.get("provider") || "").trim().toLowerCase();
  const start = toIso(query.get("start"));
  const end = toIso(query.get("end"));
  const resolutionParam = query.get("interval") || query.get("resolutionMinutes");
  const resolutionMinutes = resolutionParam == null ? null : Number(resolutionParam);

  if (!projectId) return sendJsonError(res, 400, "Missing required projectId.");
  if (!["solar", "wind"].includes(dataset)) return sendJsonError(res, 400, "Invalid dataset.");
  if (!start || !end || start > end) return sendJsonError(res, 400, "Invalid start/end range.");

  try {
    const rows = await supabaseRest({
      method: "GET",
      table: "weather_project_series",
      searchParams: {
        select: "ts,resolution_minutes,is_forecast,status,metrics,source,fetched_at,provider,dataset",
        project_id: `eq.${projectId}`,
        dataset: `eq.${dataset}`,
        provider: provider ? `eq.${provider}` : null,
        ts: `gte.${start}`,
        order: "ts.asc",
        resolution_minutes: Number.isFinite(resolutionMinutes) ? `eq.${resolutionMinutes}` : null,
      },
    });
    const filtered = (Array.isArray(rows) ? rows : []).filter((row) => String(row.ts || "") <= end);
    sendJson(res, 200, {
      ok: true,
      projectId,
      domain: "weather",
      metadata: {
        dataset,
        provider: provider || "any",
        windowStart: start,
        windowEnd: end,
        resolutionMinutes: Number.isFinite(resolutionMinutes) ? resolutionMinutes : "any",
        rowCount: filtered.length,
      },
      points: filtered.map((row) => ({
        ts: row.ts,
        value: row.metrics || {},
        isForecast: Boolean(row.is_forecast),
        status: row.status || "provisional",
      })),
    });
  } catch (error) {
    sendJsonError(res, 502, error.message || "Failed to fetch weather series.");
  }
};

const handleV3SeriesGeneration = async (req, res) => {
  if (req.method !== "GET") return sendJsonError(res, 405, "Method not allowed.");
  if (!requireSupabase(res)) return;

  const query = parseV3Query(req);
  const projectId = String(query.get("projectId") || "").trim();
  const start = toIso(query.get("start"));
  const end = toIso(query.get("end"));
  const resolutionParam = query.get("interval") || query.get("resolutionMinutes");
  const resolutionMinutes = resolutionParam == null ? null : Number(resolutionParam);

  if (!projectId) return sendJsonError(res, 400, "Missing required projectId.");
  if (!start || !end || start > end) return sendJsonError(res, 400, "Invalid start/end range.");

  try {
    const rows = await supabaseRest({
      method: "GET",
      table: "generation_project_series",
      searchParams: {
        select: "ts,resolution_minutes,solar_value,wind_value,total_value,unit,is_forecast,status,computed_at",
        project_id: `eq.${projectId}`,
        ts: `gte.${start}`,
        resolution_minutes: Number.isFinite(resolutionMinutes) ? `eq.${resolutionMinutes}` : null,
        order: "ts.asc",
      },
    });
    const filtered = (Array.isArray(rows) ? rows : []).filter((row) => String(row.ts || "") <= end);
    sendJson(res, 200, {
      ok: true,
      projectId,
      domain: "generation",
      metadata: {
        windowStart: start,
        windowEnd: end,
        resolutionMinutes: Number.isFinite(resolutionMinutes) ? resolutionMinutes : "any",
        rowCount: filtered.length,
      },
      points: filtered.map((row) => ({
        ts: row.ts,
        solar: row.solar_value,
        wind: row.wind_value,
        total: row.total_value,
        unit: row.unit,
        isForecast: Boolean(row.is_forecast),
        status: row.status || "provisional",
      })),
    });
  } catch (error) {
    sendJsonError(res, 502, error.message || "Failed to fetch generation series.");
  }
};

const fetchAllRateSeriesRows = async ({
  projectId,
  serviceType,
  marketMode,
  start,
  end,
  resolutionMinutes = null,
}) => {
  const pageSize = 1000;
  const maxPages = 50;
  const rows = [];
  let cursorStart = start;

  for (let page = 0; page < maxPages; page += 1) {
    const pageRows = await supabaseRest({
      method: "GET",
      table: "rate_project_series",
      searchParams: {
        select:
          "ts,resolution_minutes,value,is_forecast,status,source,source_url,region_id,error_code,quality_status,rates_source_fingerprint",
        project_id: `eq.${projectId}`,
        service_type: `eq.${serviceType}`,
        market_mode: `eq.${marketMode}`,
        ts: `gte.${cursorStart}`,
        resolution_minutes: Number.isFinite(resolutionMinutes) ? `eq.${resolutionMinutes}` : null,
        order: "ts.asc",
        limit: String(pageSize),
      },
    });

    const normalizedPage = Array.isArray(pageRows) ? pageRows : [];
    if (!normalizedPage.length) break;

    rows.push(...normalizedPage);

    if (normalizedPage.length < pageSize) break;
    const lastTs = normalizedPage[normalizedPage.length - 1]?.ts;
    const lastMs = Date.parse(String(lastTs || ""));
    if (!Number.isFinite(lastMs)) break;
    cursorStart = new Date(lastMs + 1).toISOString();
    if (cursorStart > end) break;
  }

  return rows.filter((row) => String(row.ts || "") <= end);
};

const handleV3SeriesRates = async (req, res) => {
  if (req.method !== "GET") return sendJsonError(res, 405, "Method not allowed.");
  if (!requireSupabase(res)) return;

  const query = parseV3Query(req);
  const projectId = String(query.get("projectId") || "").trim();
  const serviceType = String(query.get("serviceType") || "").trim();
  const marketMode = String(query.get("marketMode") || "").trim();
  const start = toIso(query.get("start"));
  const end = toIso(query.get("end"));
  const resolutionParam = query.get("interval") || query.get("resolutionMinutes");
  const resolutionMinutes = resolutionParam == null ? null : Number(resolutionParam);

  if (!projectId) return sendJsonError(res, 400, "Missing required projectId.");
  if (!["lmp", "tariff"].includes(serviceType)) return sendJsonError(res, 400, "Invalid serviceType.");
  if (!["real_time", "day_ahead", "tariff"].includes(marketMode)) return sendJsonError(res, 400, "Invalid marketMode.");
  if (!start || !end || start > end) return sendJsonError(res, 400, "Invalid start/end range.");

  try {
    const filtered = await fetchAllRateSeriesRows({
      projectId,
      serviceType,
      marketMode,
      start,
      end,
      resolutionMinutes,
    });
    const effectiveResolutionMinutes = resolveRatesResolutionMinutes({
      serviceType,
      marketMode,
      requestedResolutionMinutes: resolutionMinutes,
    });
    const expectedPoints = resolveExpectedPoints({
      startIso: start,
      endIso: end,
      resolutionMinutes: effectiveResolutionMinutes,
    });
    const availablePoints = countFiniteValueRows(filtered);
    const coverageMetrics = resolveCoverageMetrics({ expectedPoints, availablePoints });
    sendJson(res, 200, {
      ok: true,
      projectId,
      domain: "rates",
      metadata: {
        apiVersion: "v3",
        serviceType,
        marketMode,
        windowStart: start,
        windowEnd: end,
        resolutionMinutes: Number.isFinite(resolutionMinutes) ? resolutionMinutes : effectiveResolutionMinutes,
        rowCount: filtered.length,
        expectedPoints: coverageMetrics.expectedPoints,
        availablePoints: coverageMetrics.availablePoints,
        missingPoints: coverageMetrics.missingPoints,
        coveragePct: coverageMetrics.coveragePct,
        qualityStatus: coverageMetrics.qualityStatus,
        fetchedAt: new Date().toISOString(),
      },
      points: filtered.map((row) => ({
        ts: row.ts,
        value: row.value,
        isForecast: Boolean(row.is_forecast),
        status: row.status || "provisional",
        errorCode: row.error_code || null,
      })),
    });
  } catch (error) {
    sendJsonError(res, 502, error.message || "Failed to fetch rates series.");
  }
};

const handleV3Refresh = async (req, res) => {
  if (req.method !== "POST") return sendJsonError(res, 405, "Method not allowed.");
  if (!requireSupabase(res)) return;
  const body = await readJsonBody(req);
  if (body == null) return sendJsonError(res, 400, "Invalid JSON body.");
  const projectId = String(body.projectId || "").trim();
  const requestedBy = String(body.reason || body.requestedBy || "manual_refresh").trim().toLowerCase();
  let domains = Array.isArray(body.domains) ? body.domains.map((v) => String(v).trim().toLowerCase()) : ["weather", "generation", "rates"];
  if (!projectId) return sendJsonError(res, 400, "Missing required projectId.");
  if (!domains.length || domains.some((domain) => !VALID_DOMAINS.has(domain))) return sendJsonError(res, 400, "Invalid domains list.");

  try {
    if (requestedBy === "location_change" || requestedBy === "asset_change") {
      const projectRows = await supabaseRest({
        method: "GET",
        table: "projects",
        searchParams: {
          select: "id,location_lat,location_lng,weather_provider,utility_name,rates_source_fingerprint,location_fingerprint,asset_fingerprint",
          id: `eq.${projectId}`,
          limit: "1",
        },
      });
      const project = Array.isArray(projectRows) && projectRows.length ? projectRows[0] : null;
      if (!project) return sendJsonError(res, 404, "Project not found.");
      const assets = await supabaseRest({
        method: "GET",
        table: "assets",
        searchParams: {
          select: "asset_type,model",
          project_id: `eq.${projectId}`,
          order: "created_at.asc",
        },
      });
      const plan = resolveInvalidationPlan({
        reason: requestedBy,
        project,
        assets: Array.isArray(assets) ? assets : [],
      });
      domains = Array.isArray(plan.domains) && plan.domains.length ? plan.domains : domains;

      await supabaseRest({
        method: "PATCH",
        table: "projects",
        searchParams: { id: `eq.${projectId}` },
        body: plan.patch,
      });

      if (domains.length) {
        await Promise.all(
          domains.map((domain) =>
            supabaseRest({
              method: "PATCH",
              table: "domain_sync_state",
              searchParams: {
                project_id: `eq.${projectId}`,
                domain: `eq.${domain}`,
              },
              body: {
                last_success_at: null,
                last_error: `invalidated_${requestedBy}`,
                updated_at: new Date().toISOString(),
              },
            }).catch(() => null)
          )
        );
      }
    }

    const engine = createEngine();
    const outcomes = await Promise.all(
      domains.map((domain) =>
        engine.enqueue({
          projectId,
          domain,
          mode: "rolling",
          requestedBy: VALID_REQUEST_SOURCES.has(requestedBy) ? requestedBy : "manual_refresh",
          priority: 100,
          payload: {},
        })
      )
    );
    const enqueued = outcomes.filter((outcome) => !outcome.deduped).length;
    const deduped = outcomes.length - enqueued;
    sendJson(res, 200, { ok: true, projectId, domains, enqueued, deduped, mode: "rolling" });
  } catch (error) {
    sendJsonError(res, 502, error.message || "Failed to enqueue refresh jobs.");
  }
};

const handleV3CronNightlySync = async (req, res) => {
  if (req.method !== "POST") return sendJsonError(res, 405, "Method not allowed.");
  if (!requireSupabase(res)) return;
  const auth = String(req.headers["x-cron-secret"] || "");
  const expected = String(process.env.ENERGYAPP_CRON_SECRET || "");
  if (expected && auth !== expected) return sendJsonError(res, 401, "Unauthorized cron request.");

  try {
    const projects = await supabaseRest({
      method: "GET",
      table: "projects",
      searchParams: { select: "id" },
    });
    const engine = createEngine();
    const domains = ["weather", "generation", "rates"];
    const enqueueResults = [];
    for (const project of Array.isArray(projects) ? projects : []) {
      for (const domain of domains) {
        // eslint-disable-next-line no-await-in-loop
        const result = await engine.enqueue({
          projectId: project.id,
          domain,
          mode: "rolling",
          requestedBy: "nightly_cron",
          priority: 200,
          payload: {},
        });
        enqueueResults.push(result);
      }
    }
    const runResult = await engine.runBatch({ limit: Math.max(1, Math.min(100, Number(process.env.ENERGYAPP_NIGHTLY_BATCH_LIMIT || 25))) });
    const enqueued = enqueueResults.filter((item) => !item.deduped).length;
    sendJson(res, 200, {
      ok: true,
      projects: Math.floor(enqueueResults.length / 3),
      jobsQueued: enqueued,
      jobsDeduped: enqueueResults.length - enqueued,
      jobsProcessed: runResult.processed || 0,
    });
  } catch (error) {
    sendJsonError(res, 502, error.message || "Failed nightly cron enqueue.");
  }
};

const handleV3WorkerRunOnce = async (req, res) => {
  if (req.method !== "POST") return sendJsonError(res, 405, "Method not allowed.");
  if (!requireSupabase(res)) return;
  const auth = String(req.headers["x-worker-secret"] || "");
  const expected = String(process.env.ENERGYAPP_WORKER_SECRET || process.env.ENERGYAPP_CRON_SECRET || "");
  if (expected && auth !== expected) return sendJsonError(res, 401, "Unauthorized worker request.");
  try {
    const engine = createEngine();
    const batch = await engine.runBatch({ limit: 1 });
    sendJson(res, 200, { ok: true, processed: batch.processed || 0 });
  } catch (error) {
    sendJsonError(res, 502, error.message || "Worker run failed.");
  }
};

module.exports = {
  handleV3SyncDomain,
  handleV3SyncStatus,
  handleV3SeriesWeather,
  handleV3SeriesGeneration,
  handleV3SeriesRates,
  handleV3Refresh,
  handleV3CronNightlySync,
  handleV3WorkerRunOnce,
};








