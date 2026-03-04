const assert = require("assert");
const { invokeHandler, loadV3Handlers } = require("./test-helpers");

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return JSON.stringify(payload);
  },
});

const parseLegacyRatesPayload = (payload) => ({
  rowCount: Number(payload?.metadata?.rowCount || 0),
  pointsLength: Array.isArray(payload?.points) ? payload.points.length : -1,
  domain: String(payload?.domain || ""),
});

const runRatesCompatibilityTests = async () => {
  const handlers = loadV3Handlers({ url: "https://example.supabase.co", key: "sb_test_key" });
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes("/rate_project_series?")) {
      return jsonResponse([
        { ts: "2026-02-20T00:00:00.000Z", value: 11.1, status: "final" },
      ]);
    }
    if (value.includes("/ingestion_jobs?")) {
      return jsonResponse([{ id: "job-1", status: "completed" }]);
    }
    if (value.includes("/domain_sync_state?")) {
      return jsonResponse([{ project_id: "p1", domain: "weather" }]);
    }
    return jsonResponse([]);
  };

  try {
    const seriesResp = await invokeHandler(handlers.handleV3SeriesRates, {
      method: "GET",
      url: "/api/v3/series/rates?projectId=p1&serviceType=lmp&marketMode=day_ahead&start=2026-02-20T00:00:00.000Z&end=2026-02-20T01:00:00.000Z",
      headers: { host: "localhost" },
    });

    assert.strictEqual(seriesResp.statusCode, 200);
    const legacy = parseLegacyRatesPayload(seriesResp.json);
    assert.strictEqual(legacy.domain, "rates");
    assert.ok(legacy.rowCount >= 0);
    assert.ok(legacy.pointsLength >= 0);
    assert.ok(seriesResp.json?.metadata?.apiVersion);
    assert.ok(seriesResp.json?.metadata?.serviceType);
    assert.ok(seriesResp.json?.metadata?.marketMode);

    const statusResp = await invokeHandler(handlers.handleV3SyncStatus, {
      method: "GET",
      url: "/api/v3/sync/weather/status?projectId=p1",
      headers: { host: "localhost" },
    });
    assert.strictEqual(statusResp.statusCode, 200);
    assert.ok(Object.prototype.hasOwnProperty.call(statusResp.json || {}, "job"));
    assert.ok(Object.prototype.hasOwnProperty.call(statusResp.json || {}, "syncState"));
    assert.strictEqual(statusResp.json?.progress, null);
    assert.strictEqual(statusResp.json?.coverage, null);
  } finally {
    global.fetch = originalFetch;
  }
};

module.exports = { runRatesCompatibilityTests };
