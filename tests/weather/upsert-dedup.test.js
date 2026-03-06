const assert = require("assert");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");
const { runWeatherSync } = require("../../lib/v3/weather-sync");

const runWeatherUpsertDedupTests = async () => {
  const store = createMemoryIngestionJobStore();
  const fixedNow = "2026-02-26T12:00:00.000Z";
  const project = {
    id: "p-weather-upsert",
    location_lat: 33.45,
    location_lng: -112.07,
    weather_provider: "open_meteo",
  };

  await runWeatherSync({
    project,
    mode: "rolling",
    now: () => fixedNow,
    fetchWeather: async () => ({
      solar: [{ normalized_timestamp: "2026-02-26T12:00:00Z", ghi: "10" }],
      wind: [],
    }),
    store,
  });

  await runWeatherSync({
    project,
    mode: "rolling",
    now: () => fixedNow,
    fetchWeather: async () => ({
      solar: [{ normalized_timestamp: "2026-02-26T12:00:00Z", ghi: "11" }],
      wind: [],
    }),
    store,
  });

  const rows = store
    ._debugState()
    .weatherSeries.filter(
      (row) =>
        row.project_id === project.id &&
        row.dataset === "solar" &&
        row.ts === "2026-02-26T12:00:00.000Z"
    );
  assert.strictEqual(rows.length, 1, "Expected upsert on unique weather key, not duplicate inserts.");
  assert.strictEqual(rows[0].metrics.ghi, 11, "Expected latest weather metrics to overwrite prior value.");
};

module.exports = { runWeatherUpsertDedupTests };
