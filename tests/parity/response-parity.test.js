const assert = require("assert");
const { invokeHandler } = require("../api/v3/test-helpers");

const clearParityModules = () => {
  const paths = [
    "../../api/v3-proxy",
    "../../api/v3/sync/[domain].js",
    "../../api/v3/sync/[domain]/status.js",
    "../../api/v3/series/weather.js",
    "../../api/v3/series/generation.js",
    "../../api/v3/series/rates.js",
    "../../api/v3/refresh.js",
    "../../api/v3/cron/nightly-sync.js",
    "../../api/v3/worker/run-once.js",
  ];
  paths.forEach((modPath) => {
    delete require.cache[require.resolve(modPath)];
  });
};

const runResponseParityTests = async () => {
  process.env.ENERGYAPP_SUPABASE_URL = "";
  process.env.ENERGYAPP_SUPABASE_ANON_KEY = "";
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_ANON_KEY = "";
  clearParityModules();

  const direct = require("../../api/v3-proxy");
  const wrapped = {
    syncDomain: require("../../api/v3/sync/[domain].js"),
    syncStatus: require("../../api/v3/sync/[domain]/status.js"),
    weather: require("../../api/v3/series/weather.js"),
    generation: require("../../api/v3/series/generation.js"),
    rates: require("../../api/v3/series/rates.js"),
    refresh: require("../../api/v3/refresh.js"),
    nightly: require("../../api/v3/cron/nightly-sync.js"),
    worker: require("../../api/v3/worker/run-once.js"),
  };

  const fixtures = [
    {
      name: "sync-domain",
      directHandler: direct.handleV3SyncDomain,
      wrappedHandler: wrapped.syncDomain,
      request: {
        method: "POST",
        url: "/api/v3/sync/weather",
        headers: { host: "localhost" },
        body: { projectId: "p1", mode: "rolling", reason: "manual_refresh" },
      },
    },
    {
      name: "sync-status",
      directHandler: direct.handleV3SyncStatus,
      wrappedHandler: wrapped.syncStatus,
      request: {
        method: "GET",
        url: "/api/v3/sync/weather/status?projectId=p1",
        headers: { host: "localhost" },
      },
    },
    {
      name: "series-weather",
      directHandler: direct.handleV3SeriesWeather,
      wrappedHandler: wrapped.weather,
      request: {
        method: "GET",
        url: "/api/v3/series/weather?projectId=p1&dataset=solar&start=2026-01-01T00:00:00.000Z&end=2026-01-01T01:00:00.000Z",
        headers: { host: "localhost" },
      },
    },
    {
      name: "series-generation",
      directHandler: direct.handleV3SeriesGeneration,
      wrappedHandler: wrapped.generation,
      request: {
        method: "GET",
        url: "/api/v3/series/generation?projectId=p1&start=2026-01-01T00:00:00.000Z&end=2026-01-01T01:00:00.000Z",
        headers: { host: "localhost" },
      },
    },
    {
      name: "series-rates",
      directHandler: direct.handleV3SeriesRates,
      wrappedHandler: wrapped.rates,
      request: {
        method: "GET",
        url: "/api/v3/series/rates?projectId=p1&serviceType=lmp&marketMode=real_time&start=2026-01-01T00:00:00.000Z&end=2026-01-01T01:00:00.000Z",
        headers: { host: "localhost" },
      },
    },
    {
      name: "refresh",
      directHandler: direct.handleV3Refresh,
      wrappedHandler: wrapped.refresh,
      request: {
        method: "POST",
        url: "/api/v3/refresh",
        headers: { host: "localhost" },
        body: { projectId: "p1", domains: ["weather"], reason: "manual_refresh" },
      },
    },
    {
      name: "cron-nightly-sync",
      directHandler: direct.handleV3CronNightlySync,
      wrappedHandler: wrapped.nightly,
      request: {
        method: "POST",
        url: "/api/v3/cron/nightly-sync",
        headers: { host: "localhost" },
      },
    },
    {
      name: "worker-run-once",
      directHandler: direct.handleV3WorkerRunOnce,
      wrappedHandler: wrapped.worker,
      request: {
        method: "POST",
        url: "/api/v3/worker/run-once",
        headers: { host: "localhost" },
      },
    },
  ];

  for (const fixture of fixtures) {
    // eslint-disable-next-line no-await-in-loop
    const directResponse = await invokeHandler(fixture.directHandler, fixture.request);
    // eslint-disable-next-line no-await-in-loop
    const wrappedResponse = await invokeHandler(fixture.wrappedHandler, fixture.request);
    assert.strictEqual(
      directResponse.statusCode,
      wrappedResponse.statusCode,
      `Status mismatch for ${fixture.name}.`
    );
    assert.deepStrictEqual(directResponse.json, wrappedResponse.json, `Payload mismatch for ${fixture.name}.`);
  }
};

module.exports = { runResponseParityTests };
