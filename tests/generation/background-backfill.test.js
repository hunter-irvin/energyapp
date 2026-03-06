const assert = require("assert");
const { createIngestionJobEngine } = require("../../lib/v3/ingestion-job-engine");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");
const { runGenerationSync } = require("../../lib/v3/generation-sync");

const runGenerationBackgroundBackfillTests = async () => {
  const store = createMemoryIngestionJobStore();
  const project = {
    id: "p-gen-backfill",
    location_lat: 33.45,
    location_lng: -112.07,
    weather_provider: "open_meteo",
  };
  const assets = [{ asset_type: "solar", model: { capacity_ac_kw: 120 } }];

  const weatherRows = [
    { dataset: "solar", ts: "2026-01-31T23:30:00.000Z", is_forecast: false, weather_fingerprint: "wf-2", metrics: { ghi: 200, air_temperature: 20 } },
    { dataset: "solar", ts: "2026-02-01T00:00:00.000Z", is_forecast: false, weather_fingerprint: "wf-2", metrics: { ghi: 300, air_temperature: 20 } },
    { dataset: "solar", ts: "2026-02-01T00:30:00.000Z", is_forecast: false, weather_fingerprint: "wf-2", metrics: { ghi: 350, air_temperature: 20 } },
    { dataset: "solar", ts: "2026-02-01T01:00:00.000Z", is_forecast: false, weather_fingerprint: "wf-2", metrics: { ghi: 400, air_temperature: 20 } },
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
  await engine.runNext();

  const afterVisible = store._debugState().generationSeries.map((row) => row.ts).sort();
  assert.deepStrictEqual(afterVisible, ["2026-02-01T00:00:00.000Z", "2026-02-01T00:30:00.000Z"]);

  await engine.runNext();
  const afterBackfill = store._debugState().generationSeries.map((row) => row.ts).sort();
  assert.ok(afterBackfill.includes("2026-01-31T23:30:00.000Z"), "Expected rolling backfill to include earlier timestamps.");
  assert.ok(afterBackfill.includes("2026-02-01T01:00:00.000Z"), "Expected rolling backfill to include later timestamps.");
  assert.ok(afterBackfill.length > afterVisible.length, "Expected background backfill to add rows beyond visible window.");
};

module.exports = { runGenerationBackgroundBackfillTests };
