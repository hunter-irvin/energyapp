const assert = require("assert");
const { invokeHandler } = require("./v3/test-helpers");

const runParityLocalVsServerlessTests = async () => {
  process.env.ENERGYAPP_SUPABASE_URL = "https://example.supabase.co";
  process.env.ENERGYAPP_SUPABASE_ANON_KEY = "sb_test_key";

  delete require.cache[require.resolve("../../api/v3-proxy")];
  delete require.cache[require.resolve("../../api/[...path].js")];

  const { handleV3SyncDomain, handleV3SeriesWeather } = require("../../api/v3-proxy");
  const catchAll = require("../../api/[...path].js");

  const syncUrl = "/api/v3/sync/weather";
  const syncPayload = { mode: "rolling", reason: "manual_refresh" };
  const directSync = await invokeHandler(handleV3SyncDomain, {
    method: "POST",
    url: syncUrl,
    headers: { host: "localhost" },
    body: syncPayload,
  });
  const wrappedSync = await invokeHandler(catchAll, {
    method: "POST",
    url: syncUrl,
    headers: { host: "localhost" },
    body: syncPayload,
  });

  assert.strictEqual(directSync.statusCode, wrappedSync.statusCode, "Sync route parity status mismatch.");
  assert.deepStrictEqual(directSync.json, wrappedSync.json, "Sync route parity payload mismatch.");

  const weatherUrl =
    "/api/v3/series/weather?projectId=&dataset=solar&start=2026-01-01T00:00:00.000Z&end=2026-01-02T00:00:00.000Z";
  const directWeather = await invokeHandler(handleV3SeriesWeather, {
    method: "GET",
    url: weatherUrl,
    headers: { host: "localhost" },
  });
  const wrappedWeather = await invokeHandler(catchAll, {
    method: "GET",
    url: weatherUrl,
    headers: { host: "localhost" },
  });
  assert.strictEqual(directWeather.statusCode, wrappedWeather.statusCode, "Weather route parity status mismatch.");
  assert.deepStrictEqual(directWeather.json, wrappedWeather.json, "Weather route parity payload mismatch.");
};

module.exports = { runParityLocalVsServerlessTests };
