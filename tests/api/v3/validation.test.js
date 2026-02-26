const assert = require("assert");
const { invokeHandler, loadV3Handlers } = require("./test-helpers");

const runV3ValidationTests = async () => {
  const handlers = loadV3Handlers({ url: "https://example.supabase.co", key: "sb_test_key" });

  const badDomain = await invokeHandler(handlers.handleV3SyncDomain, {
    method: "POST",
    url: "/api/v3/sync/not_a_domain",
    headers: { host: "localhost" },
    body: { projectId: "p1", mode: "rolling", reason: "manual_refresh" },
  });
  assert.strictEqual(badDomain.statusCode, 400);
  assert.ok(String(badDomain.json?.errors?.[0] || "").toLowerCase().includes("invalid domain"));

  const badMode = await invokeHandler(handlers.handleV3SyncDomain, {
    method: "POST",
    url: "/api/v3/sync/weather",
    headers: { host: "localhost" },
    body: { projectId: "p1", mode: "bad_mode", reason: "manual_refresh" },
  });
  assert.strictEqual(badMode.statusCode, 400);
  assert.ok(String(badMode.json?.errors?.[0] || "").toLowerCase().includes("invalid sync mode"));

  const badSeries = await invokeHandler(handlers.handleV3SeriesRates, {
    method: "GET",
    url: "/api/v3/series/rates?projectId=p1&serviceType=lmp&marketMode=wrong&start=2026-01-01T00:00:00.000Z&end=2026-01-02T00:00:00.000Z",
    headers: { host: "localhost" },
  });
  assert.strictEqual(badSeries.statusCode, 400);
  assert.ok(String(badSeries.json?.errors?.[0] || "").toLowerCase().includes("invalid marketmode"));
};

module.exports = { runV3ValidationTests };

