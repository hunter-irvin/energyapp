const assert = require("assert");
const { invokeHandler, loadV3Handlers } = require("./test-helpers");

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return JSON.stringify(payload);
  },
});

const runRatesContractsTests = async () => {
  const handlers = loadV3Handlers({ url: "https://example.supabase.co", key: "sb_test_key" });
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const value = String(url);

    if (value.includes("/rate_project_series?") && value.includes("select=ts%2Cresolution_minutes%2Cvalue")) {
      return jsonResponse([
        { ts: "2026-02-20T00:00:00.000Z", value: 10.5 },
        { ts: "2026-02-20T00:05:00.000Z", value: 9.9 },
      ]);
    }

    if (value.includes("/ingestion_jobs?")) {
      return jsonResponse([
        {
          id: "job-1",
          status: "running",
          window_start: "2026-02-20T00:00:00.000Z",
          window_end: "2026-02-20T01:00:00.000Z",
        },
      ]);
    }

    if (value.includes("/domain_sync_state?")) {
      return jsonResponse([{ project_id: "p1", domain: "rates" }]);
    }

    if (value.includes("/rate_project_series?") && value.includes("select=ts")) {
      if (value.includes("service_type=eq.tariff") && value.includes("market_mode=eq.tariff")) {
        return jsonResponse([{ ts: "2026-02-20T00:00:00.000Z" }]);
      }
      if (value.includes("service_type=eq.lmp") && value.includes("market_mode=eq.real_time")) {
        return jsonResponse([
          { ts: "2026-02-20T00:00:00.000Z" },
          { ts: "2026-02-20T00:05:00.000Z" },
          { ts: "2026-02-20T00:10:00.000Z" },
        ]);
      }
      if (value.includes("service_type=eq.lmp") && value.includes("market_mode=eq.day_ahead")) {
        return jsonResponse([{ ts: "2026-02-20T00:00:00.000Z" }]);
      }
      return jsonResponse([]);
    }

    return jsonResponse([]);
  };

  try {
    const ratesResp = await invokeHandler(handlers.handleV3SeriesRates, {
      method: "GET",
      url: "/api/v3/series/rates?projectId=p1&serviceType=lmp&marketMode=real_time&start=2026-02-20T00:00:00.000Z&end=2026-02-20T01:00:00.000Z",
      headers: { host: "localhost" },
    });

    assert.strictEqual(ratesResp.statusCode, 200);
    assert.ok(Number.isInteger(ratesResp.json?.metadata?.expectedPoints));
    assert.ok(Number.isInteger(ratesResp.json?.metadata?.availablePoints));
    assert.ok(Number.isInteger(ratesResp.json?.metadata?.missingPoints));
    assert.strictEqual(typeof ratesResp.json?.metadata?.coveragePct, "number");
    assert.ok(["missing", "partial", "complete"].includes(ratesResp.json?.metadata?.qualityStatus));

    const statusResp = await invokeHandler(handlers.handleV3SyncStatus, {
      method: "GET",
      url: "/api/v3/sync/rates/status?projectId=p1&start=2026-02-20T00:00:00.000Z&end=2026-02-20T01:00:00.000Z",
      headers: { host: "localhost" },
    });

    assert.strictEqual(statusResp.statusCode, 200);
    assert.ok(statusResp.json?.progress);
    assert.ok(statusResp.json?.coverage);
    assert.ok(statusResp.json?.progress?.byClass?.lmpRt);
    assert.ok(statusResp.json?.progress?.byClass?.lmpDa);
    assert.ok(statusResp.json?.progress?.byClass?.tariff);
    assert.strictEqual(typeof statusResp.json?.progress?.overall?.coveragePct, "number");
    assert.ok(statusResp.json?.progress?.byClass?.lmpRt?.activeChunk);
  } finally {
    global.fetch = originalFetch;
  }
};

module.exports = { runRatesContractsTests };
