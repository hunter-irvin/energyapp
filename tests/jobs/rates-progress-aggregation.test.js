const assert = require("assert");
const { invokeHandler, loadV3Handlers } = require("../api/v3/test-helpers");

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return JSON.stringify(payload);
  },
});

const runRatesProgressAggregationTests = async () => {
  const handlers = loadV3Handlers({ url: "https://example.supabase.co", key: "sb_test_key" });
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const value = String(url);

    if (value.includes("/ingestion_jobs?")) {
      return jsonResponse([
        {
          id: "job-r3-status-1",
          status: "running",
          window_start: "2026-02-20T00:00:00.000Z",
          window_end: "2026-02-20T01:00:00.000Z",
        },
      ]);
    }
    if (value.includes("/domain_sync_state?")) {
      return jsonResponse([{ project_id: "p-r3", domain: "rates" }]);
    }
    if (value.includes("/rate_sync_chunks?")) {
      return jsonResponse([
        {
          project_id: "p-r3",
          job_id: "job-r3-status-1",
          service_type: "lmp",
          market_mode: "real_time",
          chunk_start: "2026-02-20T00:00:00.000Z",
          chunk_end: "2026-02-20T00:30:00.000Z",
          status: "running",
          updated_at: "2026-02-20T00:05:00.000Z",
        },
        {
          project_id: "p-r3",
          job_id: "job-r3-status-1",
          service_type: "lmp",
          market_mode: "day_ahead",
          chunk_start: "2026-02-20T00:00:00.000Z",
          chunk_end: "2026-02-20T01:00:00.000Z",
          status: "completed",
          updated_at: "2026-02-20T00:04:00.000Z",
        },
        {
          project_id: "p-r3",
          job_id: "job-r3-status-1",
          service_type: "tariff",
          market_mode: "tariff",
          chunk_start: "2026-02-20T00:00:00.000Z",
          chunk_end: "2026-02-20T01:00:00.000Z",
          status: "failed",
          error: "tariff_source_unavailable",
          updated_at: "2026-02-20T00:06:00.000Z",
        },
      ]);
    }
    if (value.includes("/rate_project_series?") && value.includes("service_type=eq.lmp") && value.includes("market_mode=eq.real_time")) {
      return jsonResponse([{ ts: "2026-02-20T00:00:00.000Z" }]);
    }
    if (value.includes("/rate_project_series?") && value.includes("service_type=eq.lmp") && value.includes("market_mode=eq.day_ahead")) {
      return jsonResponse([{ ts: "2026-02-20T00:00:00.000Z" }, { ts: "2026-02-20T01:00:00.000Z" }]);
    }
    if (value.includes("/rate_project_series?") && value.includes("service_type=eq.tariff") && value.includes("market_mode=eq.tariff")) {
      return jsonResponse([]);
    }

    return jsonResponse([]);
  };

  try {
    const statusResp = await invokeHandler(handlers.handleV3SyncStatus, {
      method: "GET",
      url: "/api/v3/sync/rates/status?projectId=p-r3&start=2026-02-20T00:00:00.000Z&end=2026-02-20T01:00:00.000Z",
      headers: { host: "localhost" },
    });

    assert.strictEqual(statusResp.statusCode, 200);
    const progress = statusResp.json?.progress;
    assert.ok(progress);

    assert.strictEqual(progress.byClass?.lmpRt?.runningChunks, 1);
    assert.ok(progress.byClass?.lmpRt?.activeChunk);

    assert.strictEqual(progress.byClass?.lmpDa?.completedChunks, 1);

    assert.strictEqual(progress.byClass?.tariff?.failedChunks, 1);
    assert.strictEqual(progress.byClass?.tariff?.failures?.length, 1);
    assert.ok(String(progress.byClass?.tariff?.failures?.[0]?.error || "").includes("tariff_source_unavailable"));

    assert.strictEqual(progress.overall?.totalChunks, 3);
    assert.strictEqual(progress.overall?.runningChunks, 1);
    assert.strictEqual(progress.overall?.completedChunks, 1);
    assert.strictEqual(progress.overall?.failedChunks, 1);
  } finally {
    global.fetch = originalFetch;
  }
};

module.exports = { runRatesProgressAggregationTests };
