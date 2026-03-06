const { handleWeatherProxy, handleNrelCsvProxy } = require("./weather-proxy");
const { handleLocationReverse } = require("./location-proxy");
const { handleV4RatesProvider, handleV4RatesSeries } = require("./v4-rates-proxy");

const SUPABASE_URL = process.env.ENERGYAPP_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.ENERGYAPP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
};

const handleRuntimeConfig = (_req, res) => {
  sendJson(res, 200, {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
};

const handleDiagnostics = (_req, res) => {
  sendJson(res, 200, {
    timestamp: new Date().toISOString(),
    supabase: {
      url: SUPABASE_URL,
      anonKeyPresent: !!SUPABASE_ANON_KEY,
      anonKeyLength: SUPABASE_ANON_KEY?.length || 0,
    },
    server: {
      nodeVersion: process.version,
      env: process.env.NODE_ENV || "development",
    },
  });
};

module.exports = async (req, res) => {
  const url = String(req.url || "");

  if (url.startsWith("/api/weather-proxy")) {
    return handleWeatherProxy(req, res);
  }
  if (url.startsWith("/api/nrel-proxy")) {
    return handleNrelCsvProxy(req, res);
  }
  if (url.startsWith("/api/location/reverse")) {
    return handleLocationReverse(req, res);
  }
  if (url.startsWith("/api/v4/rates/provider")) {
    return handleV4RatesProvider(req, res);
  }
  if (url.startsWith("/api/v4/rates/series")) {
    return handleV4RatesSeries(req, res);
  }
  if (url === "/api/runtime-config") {
    return handleRuntimeConfig(req, res);
  }
  if (url === "/api/diagnostics") {
    return handleDiagnostics(req, res);
  }

  return sendJson(res, 404, { errors: ["Not found."] });
};
