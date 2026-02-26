const { URL } = require("url");
const { parseIso } = require("../lib/rates/series-utils");
const { resolveProviderMetadata } = require("../lib/rates/provider-resolver");
const { buildHealthRows } = require("../lib/rates/health-utils");

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
  const details = serviceType === "tariff" ? { reason: "schedule_based" } : { reason: "live_data_or_missing" };
  const rows = buildHealthRows({
    activeRegionId: provider.isoRegion,
    serviceType,
    windowStart: start,
    windowEnd: end,
    details,
  });
  sendJson(res, 200, {
    apiVersion: "v3",
    rows,
    fetchedAt: new Date().toISOString(),
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  });
};

module.exports = {
  handleRatesProvider,
  handleRatesHealth,
};
