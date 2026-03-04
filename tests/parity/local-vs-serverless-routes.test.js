const assert = require("assert");
const { invokeHandler } = require("../api/v3/test-helpers");

const stripVolatileFields = (value) => {
  if (Array.isArray(value)) return value.map(stripVolatileFields);
  if (!value || typeof value !== "object") return value;
  return Object.entries(value).reduce((acc, [key, next]) => {
    if (["fetchedAt", "timestamp", "queuedAt", "updatedAt", "lastUpdatedAt"].includes(key)) {
      return acc;
    }
    acc[key] = stripVolatileFields(next);
    return acc;
  }, {});
};

const clearModules = () => {
  [
    "../../api/[...path].js",
    "../../api/v3-proxy.js",
    "../../api/rates-proxy.js",
    "../../api/weather-proxy.js",
    "../../api/location-proxy.js",
    "../../api/runtime-config.js",
    "../../api/diagnostics.js",
  ].forEach((modPath) => {
    delete require.cache[require.resolve(modPath)];
  });
};

const runLocalVsServerlessRoutesTests = async () => {
  process.env.ENERGYAPP_SUPABASE_URL = "";
  process.env.ENERGYAPP_SUPABASE_ANON_KEY = "";
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_ANON_KEY = "";
  clearModules();

  const catchAll = require("../../api/[...path].js");
  const v3 = require("../../api/v3-proxy.js");
  const rates = require("../../api/rates-proxy.js");
  const weather = require("../../api/weather-proxy.js");
  const location = require("../../api/location-proxy.js");
  const runtimeConfig = require("../../api/runtime-config.js");
  const diagnostics = require("../../api/diagnostics.js");

  const fixtures = [
    {
      name: "v3-sync-domain",
      directHandler: v3.handleV3SyncDomain,
      request: {
        method: "POST",
        url: "/api/v3/sync/weather",
        headers: { host: "localhost" },
        body: { projectId: "p1", mode: "rolling", reason: "manual_refresh" },
      },
    },
    {
      name: "v3-sync-status",
      directHandler: v3.handleV3SyncStatus,
      request: {
        method: "GET",
        url: "/api/v3/sync/weather/status?projectId=p1",
        headers: { host: "localhost" },
      },
    },
    {
      name: "v3-series-rates",
      directHandler: v3.handleV3SeriesRates,
      request: {
        method: "GET",
        url: "/api/v3/series/rates?projectId=p1&serviceType=lmp&marketMode=real_time&start=2026-01-01T00:00:00.000Z&end=2026-01-01T01:00:00.000Z",
        headers: { host: "localhost" },
      },
    },
    {
      name: "rates-provider",
      directHandler: rates.handleRatesProvider,
      request: {
        method: "GET",
        url: "/api/rates/provider?lat=34.05&lng=-118.25",
        headers: { host: "localhost" },
      },
    },
    {
      name: "rates-health",
      directHandler: rates.handleRatesHealth,
      request: {
        method: "GET",
        url: "/api/rates/health?lat=34.05&lng=-118.25&serviceType=lmp&start=2026-01-01T00:00:00.000Z&end=2026-01-01T01:00:00.000Z",
        headers: { host: "localhost" },
      },
    },
    {
      name: "weather-proxy",
      directHandler: weather.handleWeatherProxy,
      request: {
        method: "GET",
        url: "/api/weather-proxy?lat=34.05&lng=-118.25&provider=open_meteo&mode=load_window&requestStartDate=2026-01-01&requestEndDate=2026-01-01",
        headers: { host: "localhost" },
      },
    },
    {
      name: "nrel-proxy",
      directHandler: weather.handleNrelCsvProxy,
      request: {
        method: "GET",
        url: "/api/nrel-proxy?dataset=solar&lat=34.05&lng=-118.25",
        headers: { host: "localhost" },
      },
    },
    {
      name: "location-reverse",
      directHandler: location,
      request: {
        method: "GET",
        url: "/api/location/reverse?lat=34.05&lng=-118.25",
        headers: { host: "localhost" },
      },
    },
    {
      name: "runtime-config",
      directHandler: runtimeConfig,
      request: {
        method: "GET",
        url: "/api/runtime-config",
        headers: { host: "localhost" },
      },
    },
    {
      name: "diagnostics",
      directHandler: diagnostics,
      request: {
        method: "GET",
        url: "/api/diagnostics",
        headers: { host: "localhost" },
      },
    },
  ];

  for (const fixture of fixtures) {
    // eslint-disable-next-line no-await-in-loop
    const directResponse = await invokeHandler(fixture.directHandler, fixture.request);
    // eslint-disable-next-line no-await-in-loop
    const wrappedResponse = await invokeHandler(catchAll, fixture.request);
    assert.strictEqual(directResponse.statusCode, wrappedResponse.statusCode, `Status mismatch for ${fixture.name}.`);
    assert.deepStrictEqual(
      stripVolatileFields(directResponse.json),
      stripVolatileFields(wrappedResponse.json),
      `Payload mismatch for ${fixture.name}.`
    );
  }

  const deprecatedRoutes = ["/api/rates/timeseries", "/api/v2/rates/timeseries", "/api/rates/refresh"];
  for (const route of deprecatedRoutes) {
    // eslint-disable-next-line no-await-in-loop
    const response = await invokeHandler(catchAll, { method: "GET", url: route, headers: { host: "localhost" } });
    assert.strictEqual(response.statusCode, 410, `Expected 410 for deprecated route ${route}.`);
  }
};

module.exports = { runLocalVsServerlessRoutesTests };

