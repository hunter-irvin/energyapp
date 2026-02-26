const assert = require("assert");
const { invokeHandler, loadV3Handlers } = require("../api/v3/test-helpers");

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return JSON.stringify(payload);
  },
});

const runDualReadPrecedenceTests = async () => {
  process.env.ENERGYAPP_V3_DUAL_READ = "1";
  const handlers = loadV3Handlers({ url: "https://example.supabase.co", key: "sb_test_key" });
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes("/weather_project_series?")) {
      return jsonResponse([
        {
          ts: "2026-02-20T00:00:00.000Z",
          resolution_minutes: 30,
          is_forecast: false,
          status: "final",
          metrics: { ghi: 777 },
          provider: "open_meteo",
          dataset: "solar",
        },
      ]);
    }
    if (value.includes("/weather_cache?")) {
      return jsonResponse([
        {
          project_id: "p1",
          provider: "open_meteo",
          dataset: "solar",
          fetched_at: "2026-02-20T00:00:00.000Z",
          payload: [{ normalized_timestamp: "2026-02-20T00:00:00Z", ghi: 111 }],
        },
      ]);
    }
    return jsonResponse([]);
  };

  try {
    const response = await invokeHandler(handlers.handleV3SeriesWeather, {
      method: "GET",
      url: "/api/v3/series/weather?projectId=p1&dataset=solar&start=2026-02-20T00:00:00.000Z&end=2026-02-20T01:00:00.000Z",
      headers: { host: "localhost" },
    });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.json?.metadata?.dualReadSource, "primary");
    assert.strictEqual(response.json?.points?.[0]?.value?.ghi, 777);
  } finally {
    global.fetch = originalFetch;
    delete process.env.ENERGYAPP_V3_DUAL_READ;
  }
};

module.exports = { runDualReadPrecedenceTests };
