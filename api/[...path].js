const { handleWeatherProxy, handleNrelCsvProxy } = require("./weather-proxy");
const { handleLocationReverse } = require("./location-proxy");
const { handleRatesProvider, handleRatesHealth } = require("./rates-proxy");
const {
  handleV3SyncDomain,
  handleV3SyncStatus,
  handleV3SeriesWeather,
  handleV3SeriesGeneration,
  handleV3SeriesRates,
  handleV3Refresh,
  handleV3CronNightlySync,
  handleV3WorkerRunOnce,
} = require("./v3-proxy");

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

const sendDeprecated = (res, message) =>
  sendJson(res, 410, {
    errors: [String(message || "Deprecated endpoint.")],
  });

const handleRuntimeConfig = (req, res) => {
  sendJson(res, 200, {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
};

const handleDiagnostics = (req, res) => {
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

const sendNotFound = (res) => {
  sendJson(res, 404, { errors: ["Not found."] });
};

module.exports = (req, res) => {
  const url = String(req.url || "");

  if (url.startsWith("/api/weather-proxy")) {
    handleWeatherProxy(req, res);
    return;
  }
  if (url.startsWith("/api/nrel-proxy")) {
    handleNrelCsvProxy(req, res);
    return;
  }
  if (url.startsWith("/api/location/reverse")) {
    handleLocationReverse(req, res);
    return;
  }
  if (url.startsWith("/api/rates/provider")) {
    handleRatesProvider(req, res);
    return;
  }
  if (url.startsWith("/api/rates/health")) {
    handleRatesHealth(req, res);
    return;
  }
  if (url.startsWith("/api/rates/refresh")) {
    sendDeprecated(res, "Deprecated endpoint. Use POST /api/v3/refresh.");
    return;
  }
  if (url.startsWith("/api/rates/timeseries")) {
    sendDeprecated(res, "Deprecated endpoint. Use /api/v3/series/rates and /api/v3/refresh.");
    return;
  }
  if (url.startsWith("/api/v2/rates/timeseries")) {
    sendDeprecated(res, "Deprecated endpoint. Use /api/v3/series/rates and /api/v3/refresh.");
    return;
  }

  if (url.startsWith("/api/v3/sync/") && url.includes("/status")) {
    handleV3SyncStatus(req, res);
    return;
  }
  if (url.startsWith("/api/v3/sync/")) {
    handleV3SyncDomain(req, res);
    return;
  }
  if (url.startsWith("/api/v3/series/weather")) {
    handleV3SeriesWeather(req, res);
    return;
  }
  if (url.startsWith("/api/v3/series/generation")) {
    handleV3SeriesGeneration(req, res);
    return;
  }
  if (url.startsWith("/api/v3/series/rates")) {
    handleV3SeriesRates(req, res);
    return;
  }
  if (url.startsWith("/api/v3/refresh")) {
    handleV3Refresh(req, res);
    return;
  }
  if (url.startsWith("/api/v3/cron/nightly-sync")) {
    handleV3CronNightlySync(req, res);
    return;
  }
  if (url.startsWith("/api/v3/worker/run-once")) {
    handleV3WorkerRunOnce(req, res);
    return;
  }

  if (url === "/api/runtime-config") {
    handleRuntimeConfig(req, res);
    return;
  }

  if (url === "/api/diagnostics") {
    handleDiagnostics(req, res);
    return;
  }

  sendNotFound(res);
};
