const assert = require("assert");
const { invokeHandler, loadV3Handlers } = require("../api/v3/test-helpers");

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return JSON.stringify(payload);
  },
});

const runNoRegressionSmokeTests = async () => {
  const handlers = loadV3Handlers({ url: "https://example.supabase.co", key: "sb_test_key" });
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes("/weather_project_series?")) return jsonResponse([]);
    if (value.includes("/rate_project_series?")) return jsonResponse([]);
    return jsonResponse([]);
  };

  try {
    const weatherResp = await invokeHandler(handlers.handleV3SeriesWeather, {
      method: "GET",
      url: "/api/v3/series/weather?projectId=p-smoke&dataset=solar&start=2026-02-20T00:00:00.000Z&end=2026-02-20T01:00:00.000Z",
      headers: { host: "localhost" },
    });
    assert.strictEqual(weatherResp.statusCode, 200);
    assert.ok(Array.isArray(weatherResp.json?.points) && weatherResp.json.points.length === 0);

    const ratesResp = await invokeHandler(handlers.handleV3SeriesRates, {
      method: "GET",
      url: "/api/v3/series/rates?projectId=p-smoke&serviceType=lmp&marketMode=real_time&start=2026-02-20T00:00:00.000Z&end=2026-02-20T01:00:00.000Z",
      headers: { host: "localhost" },
    });
    assert.strictEqual(ratesResp.statusCode, 200);
    assert.ok(Array.isArray(ratesResp.json?.points) && ratesResp.json.points.length === 0);
  } finally {
    global.fetch = originalFetch;
  }
};

module.exports = { runNoRegressionSmokeTests };
