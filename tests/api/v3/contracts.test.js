const assert = require("assert");
const { invokeHandler, loadV3Handlers } = require("./test-helpers");

const runV3ContractTests = async () => {
  const handlers = loadV3Handlers({ url: "", key: "" });

  const syncResp = await invokeHandler(handlers.handleV3SyncDomain, {
    method: "POST",
    url: "/api/v3/sync/weather",
    headers: { host: "localhost" },
    body: { projectId: "p1", mode: "rolling", reason: "manual_refresh" },
  });
  assert.strictEqual(syncResp.statusCode, 503, "Expected sync endpoint to return 503 without Supabase config.");
  assert.ok(Array.isArray(syncResp.json?.errors), "Expected sync error payload.");

  const weatherResp = await invokeHandler(handlers.handleV3SeriesWeather, {
    method: "GET",
    url: "/api/v3/series/weather?projectId=p1&dataset=solar&start=2026-01-01T00:00:00.000Z&end=2026-01-02T00:00:00.000Z",
    headers: { host: "localhost" },
  });
  assert.strictEqual(weatherResp.statusCode, 503, "Expected series endpoint to return 503 without Supabase config.");
  assert.ok(Array.isArray(weatherResp.json?.errors), "Expected weather series error payload.");

  const refreshResp = await invokeHandler(handlers.handleV3Refresh, {
    method: "POST",
    url: "/api/v3/refresh",
    headers: { host: "localhost" },
    body: { projectId: "p1", domains: ["weather"] },
  });
  assert.strictEqual(refreshResp.statusCode, 503, "Expected refresh endpoint to return 503 without Supabase config.");
  assert.ok(Array.isArray(refreshResp.json?.errors), "Expected refresh error payload.");
};

module.exports = { runV3ContractTests };

