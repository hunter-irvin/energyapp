const { URL } = require("url");
const { parseIso } = require("./rates/series-utils");
const { resolveProviderMetadata } = require("./rates/provider-resolver");
const { getLmpSeries } = require("./rates/lmp-adapters");
const { getTariffSeries } = require("./rates/tariff-adapters");
const { buildHealthRows } = require("./rates/health");

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
  return { lat, lng, serviceType, marketMode, start, end };
};

const buildTimeseriesPayload = async (request) => {
  const { lat, lng, serviceType, marketMode, start, end } = request;
  const provider = await resolveProviderMetadata({ lat, lng });
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

module.exports = {
  handleRatesProvider,
  handleRatesTimeseries,
  handleRatesTimeseriesV2,
  handleRatesHealth,
  handleRatesRefresh,
};
