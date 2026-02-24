const { URL } = require("url");
const { parseIso } = require("../lib/rates/series-utils");
const { resolveProviderMetadata } = require("../lib/rates/provider-resolver");
const { getLmpSeries } = require("../lib/rates/lmp-adapters");
const { getTariffSeries } = require("../lib/rates/tariff-adapters");
const { buildHealthRows } = require("../lib/rates/health-utils");
const rateStore = require("../lib/rates/project-rate-store");
const { startBackfillJob, getBackfillJobStatus } = require("../lib/rates/backfill-manager");

const sendJsonError = (res, status, message) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ errors: [message] }));
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
};

const pad2 = (value) => String(value).padStart(2, "0");
const SUPPORTED_SOURCE_UNITS = new Set(["USD/MWh", "USD/kWh", "cents/kWh"]);

const resolveSourceUnit = ({ seriesUnit, serviceType }) => {
  const normalized = String(seriesUnit || "").trim().toLowerCase();
  if (normalized) return seriesUnit;
  return serviceType === "lmp" ? "USD/MWh" : "USD/kWh";
};

const resolveConfidence = ({ serviceType, details = {}, source = "" }) => {
  const reason = String(details.reason || "").toLowerCase();
  const normalizedSource = String(source || "").toLowerCase();
  if (reason.includes("modeled_backfill")) return "medium";
  if (reason === "live_data" || normalizedSource.includes("_live")) return "high";
  if (reason.includes("fallback") || normalizedSource.includes("fallback")) return "low";
  if (serviceType === "tariff") return "medium";
  return "medium";
};

const computeQualityStatus = (points = []) => {
  const expected = Array.isArray(points) ? points.length : 0;
  if (!expected) return "missing";
  const missing = points.reduce((sum, point) => (point?.value == null ? sum + 1 : sum), 0);
  const coverage = 1 - missing / expected;
  if (coverage >= 0.95) return "good";
  if (coverage >= 0.2) return "partial";
  return "missing";
};

const validateSeriesContract = ({ points = [], sourceUnit }) => {
  if (!SUPPORTED_SOURCE_UNITS.has(String(sourceUnit || "").trim())) {
    throw new Error(`Unsupported source unit '${sourceUnit || ""}'`);
  }
  if (!Array.isArray(points)) throw new Error("Series points must be an array.");
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i] || {};
    const ts = new Date(point.ts);
    if (Number.isNaN(ts.getTime())) throw new Error(`Invalid point timestamp at index ${i}.`);
    if (!(point.value == null || Number.isFinite(Number(point.value)))) {
      throw new Error(`Invalid point value at index ${i}.`);
    }
  }
};

const handleRatesProvider = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    sendJsonError(res, 400, "Missing required latitude/longitude.");
    return;
  }
  const provider = await resolveProviderMetadata({ lat, lng });
  sendJson(res, 200, { provider, fetchedAt: new Date().toISOString() });
};

const parseTimeseriesRequest = (req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const serviceType = url.searchParams.get("serviceType") || "lmp";
  const marketModeRaw = url.searchParams.get("marketMode") || "day_ahead";
  const start = parseIso(url.searchParams.get("start"));
  const end = parseIso(url.searchParams.get("end"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Missing required latitude/longitude.");
  if (!start || !end || start > end) throw new Error("Invalid start/end range.");
  if (!["lmp", "tariff"].includes(serviceType)) throw new Error("Invalid serviceType.");
  const marketMode = serviceType === "tariff" ? "tariff" : marketModeRaw;
  if (!["real_time", "day_ahead", "tariff"].includes(marketMode)) throw new Error("Invalid marketMode.");
  return { projectId, lat, lng, serviceType, marketMode, start, end };
};

const getHotWindowCutoff = ({ marketMode }) => {
  const now = Date.now();
  if (marketMode === "real_time") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (marketMode === "day_ahead") return new Date(now - 3 * 24 * 60 * 60 * 1000);
  return new Date(now - 30 * 24 * 60 * 60 * 1000);
};

const mapStoredRowsToPoints = (rows = []) =>
  Array.from(
    rows.reduce((map, row) => {
      if (!row?.ts) return map;
      map.set(row.ts, {
        ts: row.ts,
        value: row.value == null ? null : Number(row.value),
        isForecast: Boolean(row.is_forecast),
        missingReason: row.value == null ? "No rate data from project store." : null,
      });
      return map;
    }, new Map()).values()
  ).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

const getHotWindowServeThreshold = ({ marketMode }) => {
  if (marketMode === "real_time") return { maxAgeMs: 3 * 60 * 60 * 1000, minCoverage: 0.75 };
  if (marketMode === "day_ahead") return { maxAgeMs: 36 * 60 * 60 * 1000, minCoverage: 0.7 };
  return { maxAgeMs: 7 * 24 * 60 * 60 * 1000, minCoverage: 0.6 };
};

const estimateCoverage = ({ points = [], start, end, resolutionMinutes }) => {
  const stepMs = Math.max(1, Number(resolutionMinutes || 60)) * 60 * 1000;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  const expectedPoints = Math.max(1, Math.floor((endMs - startMs) / stepMs) + 1);
  const presentPoints = points.reduce((sum, point) => (Number.isFinite(Number(point?.value)) ? sum + 1 : sum), 0);
  return Math.max(0, Math.min(1, presentPoints / expectedPoints));
};

const canServeHotWindowFromStore = ({ points = [], start, end, marketMode, resolutionMinutes }) => {
  if (!points.length) return false;
  const { maxAgeMs, minCoverage } = getHotWindowServeThreshold({ marketMode });
  const coverage = estimateCoverage({ points, start, end, resolutionMinutes });
  if (coverage < minCoverage) return false;
  const latestPointMs = points.reduce((max, point) => {
    const ts = new Date(point?.ts).getTime();
    return Number.isFinite(ts) ? Math.max(max, ts) : max;
  }, 0);
  if (!Number.isFinite(latestPointMs) || latestPointMs <= 0) return false;
  return Date.now() - latestPointMs <= maxAgeMs;
};

const buildTimeseriesPayload = async (request) => {
  const { projectId, lat, lng, serviceType, marketMode, start, end } = request;
  const provider = await resolveProviderMetadata({ lat, lng });
  const isColdWindow = end.getTime() <= getHotWindowCutoff({ marketMode }).getTime();
  if (projectId) {
    const resolutionMinutes = serviceType === "lmp" && marketMode === "real_time" ? 15 : 60;
    const storedRows = await rateStore
      .listRatePoints({
        projectId,
        regionId: provider.isoRegion,
        serviceType,
        marketMode,
        start: start.toISOString(),
        end: end.toISOString(),
        resolutionMinutes,
      })
      .catch(() => []);
    const storedPoints = mapStoredRowsToPoints(storedRows);
    if (storedPoints.length && (isColdWindow || canServeHotWindowFromStore({ points: storedPoints, start, end, marketMode, resolutionMinutes }))) {
      const sourceUnit = serviceType === "lmp" ? "USD/MWh" : "USD/kWh";
      const qualityStatus = computeQualityStatus(storedPoints);
      return {
        metadata: {
          apiVersion: "v2",
          serviceType,
          marketMode,
          regionId: provider.isoRegion,
          regionLabel: provider.regionLabel || provider.isoRegion,
          utilityName: provider.utilityName,
          utilityCode: provider.utilityCode,
          timezone: provider.timezone,
          unit: sourceUnit,
          sourceUnit,
          source: "rates_project_store",
          details: {
            reason: isColdWindow ? "project_store_backfill" : "project_store_hot_cache",
            sourceUrl: "supabase://rate_project_series",
            resolutionMinutes,
          },
          confidence: isColdWindow ? "high" : "medium",
          qualityStatus,
          fetchedAt: new Date().toISOString(),
          windowStart: start.toISOString(),
          windowEnd: end.toISOString(),
        },
        points: storedPoints,
      };
    }
  }
  const series =
    serviceType === "tariff"
      ? await getTariffSeries({
          regionId: provider.isoRegion,
          start,
          end,
          tariffProgramId: provider.tariffProgramId,
        })
      : await getLmpSeries({
          regionId: provider.isoRegion,
          marketMode,
          start,
          end,
          lat,
          lng,
          utilityCode: provider.utilityCode,
        });
  const sourceUnit = resolveSourceUnit({ seriesUnit: series.unit, serviceType });
  validateSeriesContract({ points: series.points || [], sourceUnit });
  const confidence = resolveConfidence({ serviceType, details: series.details, source: series.source });
  const qualityStatus = computeQualityStatus(series.points || []);
  if (projectId && Array.isArray(series.points) && series.points.length) {
    const resolutionMinutes = serviceType === "lmp" && marketMode === "real_time" ? 15 : 60;
    const rows = series.points.map((point) => ({
      projectId,
      regionId: provider.isoRegion,
      serviceType,
      marketMode,
      ts: point.ts,
      resolutionMinutes,
      value: point.value == null ? null : Number(point.value),
      isForecast: Boolean(point.isForecast),
      isModeled: point?.missingReason === "modeled_backfill",
      source: series.source || "rates_proxy_phase2",
      sourceUrl: series?.details?.sourceUrl || "",
      status: "provisional",
      finalizedAt: null,
    }));
    void rateStore.upsertRatePoints(rows).catch(() => {});
  }
  return {
    metadata: {
      apiVersion: "v2",
      serviceType,
      marketMode,
      regionId: provider.isoRegion,
      regionLabel: provider.regionLabel || provider.isoRegion,
      utilityName: provider.utilityName,
      utilityCode: provider.utilityCode,
      timezone: provider.timezone,
      unit: sourceUnit,
      sourceUnit,
      source: series.source || "rates_proxy_phase2",
      details: series.details || {},
      confidence: confidence || provider.confidence || "medium",
      qualityStatus,
      fetchedAt: new Date().toISOString(),
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
    },
    points: series.points || [],
    missingIntervals: series.missingIntervals,
  };
};

const handleTimeseriesWithContract = async (req, res) => {
  try {
    const parsed = parseTimeseriesRequest(req);
    const payload = await buildTimeseriesPayload(parsed);
    sendJson(res, 200, payload);
  } catch (error) {
    const message = String(error?.message || "Failed to retrieve rate timeseries.");
    const isInputError = message.startsWith("Missing required ") || message.startsWith("Invalid ");
    sendJsonError(res, isInputError ? 400 : 502, message);
  }
};

const handleRatesTimeseries = async (req, res) => handleTimeseriesWithContract(req, res);
const handleRatesTimeseriesV2 = async (req, res) => handleTimeseriesWithContract(req, res);

const handleRatesHealth = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const serviceType = url.searchParams.get("serviceType") || "lmp";
  const start = parseIso(url.searchParams.get("start"));
  const end = parseIso(url.searchParams.get("end"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    sendJsonError(res, 400, "Missing required latitude/longitude.");
    return;
  }
  if (!start || !end || start > end) {
    sendJsonError(res, 400, "Invalid start/end range.");
    return;
  }
  if (!["lmp", "tariff", "all"].includes(serviceType)) {
    sendJsonError(res, 400, "Invalid serviceType.");
    return;
  }
  const provider = await resolveProviderMetadata({ lat, lng });
  const details = serviceType === "tariff" ? { reason: "schedule_based" } : { reason: "live_or_fallback" };
  const rows = buildHealthRows({
    activeRegionId: provider.isoRegion,
    serviceType,
    windowStart: start,
    windowEnd: end,
    details,
  });
  sendJson(res, 200, {
    apiVersion: "v2",
    rows,
    fetchedAt: new Date().toISOString(),
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  });
};

const handleRatesRefresh = async (req, res) => {
  const now = new Date();
  sendJson(res, 200, {
    ok: true,
    refreshedAt: `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}T${pad2(
      now.getUTCHours()
    )}:${pad2(now.getUTCMinutes())}:${pad2(now.getUTCSeconds())}Z`,
    source: "rates_proxy_phase2",
  });
};

const handleRatesBackfillStart = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const projectId = String(url.searchParams.get("projectId") || "").trim();
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    const forceRaw = String(url.searchParams.get("force") || "").toLowerCase();
    const force = ["1", "true", "yes"].includes(forceRaw);
    if (!projectId) throw new Error("Missing required projectId.");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Missing required latitude/longitude.");
    const job = await startBackfillJob({ projectId, lat, lng, force });
    sendJson(res, 200, {
      ok: true,
      job,
      source: "rates_backfill_manager",
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    sendJsonError(res, 400, String(error?.message || "Unable to start backfill job."));
  }
};

const handleRatesBackfillStatus = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const projectId = String(url.searchParams.get("projectId") || "").trim();
    if (!projectId) throw new Error("Missing required projectId.");
    const job = await getBackfillJobStatus(projectId);
    sendJson(res, 200, {
      ok: true,
      job: job || { projectId, status: "idle", progressPct: 0, totalTasks: 0, completedTasks: 0 },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    sendJsonError(res, 400, String(error?.message || "Unable to load backfill job status."));
  }
};

module.exports = {
  handleRatesProvider,
  handleRatesTimeseries,
  handleRatesTimeseriesV2,
  handleRatesHealth,
  handleRatesRefresh,
  handleRatesBackfillStart,
  handleRatesBackfillStatus,
};
