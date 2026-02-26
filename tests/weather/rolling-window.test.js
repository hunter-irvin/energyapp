const assert = require("assert");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");
const { runWeatherSync } = require("../../lib/v3/weather-sync");

const runWeatherRollingWindowTests = async () => {
  const store = createMemoryIngestionJobStore();
  const fixedNow = "2026-02-26T12:00:00.000Z";
  const result = await runWeatherSync({
    project: {
      id: "p-weather-window",
      location_lat: 33.45,
      location_lng: -112.07,
      weather_provider: "open_meteo",
    },
    mode: "rolling",
    now: () => fixedNow,
    fetchWeather: async () => ({
      solar: [
        { normalized_timestamp: "2026-01-20T12:00:00Z", ghi: "1" },
        { normalized_timestamp: "2026-01-27T00:00:00Z", ghi: "2" },
        { normalized_timestamp: "2026-03-05T23:30:00Z", ghi: "3" },
        { normalized_timestamp: "2026-03-06T00:00:00Z", ghi: "4" },
      ],
      wind: [
        { normalized_timestamp: "2026-01-26T23:30:00Z", windspeed_100m: "5" },
        { normalized_timestamp: "2026-03-05T23:30:00Z", windspeed_100m: "6" },
        { normalized_timestamp: "2026-03-06T00:00:00Z", windspeed_100m: "7" },
      ],
    }),
    store,
  });

  assert.strictEqual(result.windowStart, "2026-01-27T00:00:00.000Z");
  assert.strictEqual(result.windowEnd, "2026-03-05T23:59:59.999Z");

  const rows = store._debugState().weatherSeries;
  assert.ok(rows.length > 0, "Expected normalized weather rows.");
  assert.strictEqual(
    rows.filter((row) => row.ts < result.windowStart || row.ts > result.windowEnd).length,
    0,
    "Expected all rows constrained to rolling weather window."
  );
};

module.exports = { runWeatherRollingWindowTests };
