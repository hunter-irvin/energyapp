const assert = require("assert");
const { createIngestionJobEngine } = require("../../lib/v3/ingestion-job-engine");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");
const { runGenerationSync } = require("../../lib/v3/generation-sync");

const runGenerationVisibleWindowPriorityTests = async () => {
  const store = createMemoryIngestionJobStore();
  const weatherRows = [
    {
      dataset: "solar",
      ts: "2026-02-01T00:00:00.000Z",
      is_forecast: false,
      weather_fingerprint: "wf-1",
      metrics: { ghi: 500, air_temperature: 20 },
    },
    {
      dataset: "wind",
      ts: "2026-02-01T00:00:00.000Z",
      is_forecast: false,
      weather_fingerprint: "wf-1",
      metrics: { windspeed_100m: 8, temperature_100m: 15, pressure_100m: 101325 },
    },
    {
      dataset: "solar",
      ts: "2026-02-01T00:30:00.000Z",
      is_forecast: false,
      weather_fingerprint: "wf-1",
      metrics: { ghi: 600, air_temperature: 20 },
    },
    {
      dataset: "wind",
      ts: "2026-02-01T00:30:00.000Z",
      is_forecast: false,
      weather_fingerprint: "wf-1",
      metrics: { windspeed_100m: 9, temperature_100m: 15, pressure_100m: 101325 },
    },
  ];
  const project = {
    id: "p-gen-priority",
    location_lat: 33.45,
    location_lng: -112.07,
    weather_provider: "open_meteo",
  };
  const assets = [
    { asset_type: "solar", model: { capacity_ac_kw: 100 } },
    { asset_type: "wind", model: { rated_power_kw: 2000, num_turbines: 1 } },
  ];

  const engine = createIngestionJobEngine({
    store,
    handlers: {
      generation: async (job, helper) =>
        runGenerationSync({
          project,
          mode: job.mode,
          windowStart: job.window_start,
          windowEnd: job.window_end,
          requestedBy: job.requested_by,
          now: () => "2026-02-01T01:00:00.000Z",
          readAssets: async () => assets,
          readWeatherSeries: async ({ startIso, endIso }) =>
            weatherRows.filter((row) => row.ts >= startIso && row.ts <= endIso),
          store,
          enqueueJob: helper.enqueue,
        }),
    },
  });

  await engine.enqueue({
    projectId: project.id,
    domain: "generation",
    mode: "visible_window",
    requestedBy: "manual_refresh",
    windowStart: "2026-02-01T00:00:00.000Z",
    windowEnd: "2026-02-01T00:30:00.000Z",
  });
  const outcome = await engine.runNext();

  assert.strictEqual(outcome.ran, true);
  assert.strictEqual(outcome.result.backgroundEnqueued, true, "Expected visible-window run to enqueue rolling backfill.");
  const state = store._debugState();
  assert.strictEqual(state.generationSeries.length, 2, "Expected only visible-window rows before backfill run.");
  const queuedRolling = state.jobs.filter(
    (row) => row.domain === "generation" && row.mode === "rolling" && row.status === "queued"
  );
  assert.strictEqual(queuedRolling.length, 1, "Expected one queued rolling generation backfill job.");
};

module.exports = { runGenerationVisibleWindowPriorityTests };
