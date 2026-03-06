const assert = require("assert");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");
const { runGenerationSync } = require("../../lib/v3/generation-sync");

const runGenerationOverwriteSemanticsTests = async () => {
  const store = createMemoryIngestionJobStore();
  const project = {
    id: "p-gen-overwrite",
    location_lat: 33.45,
    location_lng: -112.07,
    weather_provider: "open_meteo",
  };
  const assets = [{ asset_type: "solar", model: { capacity_ac_kw: 100 } }];
  const ts = "2026-02-01T00:00:00.000Z";

  await runGenerationSync({
    project,
    mode: "rolling",
    now: () => "2026-02-01T01:00:00.000Z",
    readAssets: async () => assets,
    readWeatherSeries: async () => [
      {
        dataset: "solar",
        ts,
        is_forecast: false,
        weather_fingerprint: "wf-low",
        metrics: { ghi: 200, air_temperature: 20 },
      },
    ],
    store,
  });

  await runGenerationSync({
    project,
    mode: "rolling",
    now: () => "2026-02-01T01:00:00.000Z",
    readAssets: async () => assets,
    readWeatherSeries: async () => [
      {
        dataset: "solar",
        ts,
        is_forecast: false,
        weather_fingerprint: "wf-high",
        metrics: { ghi: 900, air_temperature: 20 },
      },
    ],
    store,
  });

  const rows = store
    ._debugState()
    .generationSeries.filter((row) => row.project_id === project.id && row.ts === ts);
  assert.strictEqual(rows.length, 1, "Expected generation recompute to overwrite existing timestamp row.");
  assert.ok(rows[0].solar_value > 0, "Expected non-zero recomputed generation value.");
  assert.strictEqual(rows[0].weather_fingerprint, "wf-high", "Expected latest weather fingerprint to overwrite prior row.");
};

module.exports = { runGenerationOverwriteSemanticsTests };
