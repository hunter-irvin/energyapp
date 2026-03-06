const assert = require("assert");
const { createIngestionJobEngine } = require("../../lib/v3/ingestion-job-engine");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");
const { runWeatherSync } = require("../../lib/v3/weather-sync");

const runWeatherSyncStateTests = async () => {
  const store = createMemoryIngestionJobStore();
  const fixedNow = "2026-02-26T12:00:00.000Z";
  const project = {
    id: "p-weather-sync-state",
    location_lat: 33.45,
    location_lng: -112.07,
    weather_provider: "open_meteo",
  };

  const engine = createIngestionJobEngine({
    store,
    now: () => fixedNow,
    handlers: {
      weather: async (job) =>
        runWeatherSync({
          project,
          mode: job.mode,
          windowStart: job.window_start,
          windowEnd: job.window_end,
          now: () => fixedNow,
          fetchWeather: async () => ({
            solar: [{ normalized_timestamp: "2026-02-26T12:00:00Z", ghi: "2" }],
            wind: [{ normalized_timestamp: "2026-02-26T12:00:00Z", windspeed_100m: "4" }],
          }),
          store,
        }),
    },
  });

  await engine.enqueue({
    projectId: project.id,
    domain: "weather",
    mode: "rolling",
    requestedBy: "manual_refresh",
  });
  await engine.runNext();

  const afterSuccess = store
    ._debugState()
    .syncState.find((row) => row.project_id === project.id && row.domain === "weather");
  assert.ok(afterSuccess, "Expected domain sync state row after success.");
  assert.ok(afterSuccess.last_success_at, "Expected successful weather sync timestamp.");
  assert.ok(afterSuccess.rolling_start, "Expected rolling_start to be persisted.");
  assert.ok(afterSuccess.rolling_end, "Expected rolling_end to be persisted.");
  assert.strictEqual(afterSuccess.last_error, null, "Expected no error after success.");

  const failingEngine = createIngestionJobEngine({
    store,
    now: () => fixedNow,
    handlers: {
      weather: async () => {
        throw new Error("weather_upstream_failed");
      },
    },
  });

  await failingEngine.enqueue({
    projectId: project.id,
    domain: "weather",
    mode: "rolling",
    requestedBy: "manual_refresh",
  });
  await failingEngine.runNext();

  const afterFailure = store
    ._debugState()
    .syncState.find((row) => row.project_id === project.id && row.domain === "weather");
  assert.ok(afterFailure.last_attempt_at, "Expected last_attempt_at after failed weather sync.");
  assert.ok(
    String(afterFailure.last_error || "").includes("weather_upstream_failed"),
    "Expected sync state last_error to capture upstream failure."
  );
};

module.exports = { runWeatherSyncStateTests };
