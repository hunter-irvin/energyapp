const assert = require("assert");
const path = require("path");

global.window = {};
require(path.join(__dirname, "..", "public", "assets", "js", "core", "data-utils.js"));

const { normalizeHeader, mapHeaders, mergeSeriesOnTimestamps } = global.window.EnergyDataUtils;
const { runSolarComputeTests } = require(path.join(__dirname, "solar-compute.test.js"));
const { runWindComputeTests } = require(path.join(__dirname, "wind-compute.test.js"));
const { runDbSchemaTests } = require(path.join(__dirname, "db", "schema.test.js"));
const { runDbRlsTests } = require(path.join(__dirname, "db", "rls.test.js"));
const { runDbConstraintTests } = require(path.join(__dirname, "db", "constraint.test.js"));
const { runSupabaseRequiredTests } = require(path.join(__dirname, "client", "supabase-required.test.js"));
const { runNoLocalDomainFallbackTests } = require(path.join(__dirname, "client", "no-local-domain-fallback.test.js"));
const { runV3ContractTests } = require(path.join(__dirname, "api", "v3", "contracts.test.js"));
const { runV3ValidationTests } = require(path.join(__dirname, "api", "v3", "validation.test.js"));
const { runParityLocalVsServerlessTests } = require(path.join(__dirname, "api", "parity-local-vs-serverless.test.js"));
const { runJobLifecycleTests } = require(path.join(__dirname, "jobs", "lifecycle.test.js"));
const { runJobIdempotencyTests } = require(path.join(__dirname, "jobs", "idempotency.test.js"));
const { runJobRetryTests } = require(path.join(__dirname, "jobs", "retry.test.js"));
const { runWeatherRollingWindowTests } = require(path.join(__dirname, "weather", "rolling-window.test.js"));
const { runWeatherUpsertDedupTests } = require(path.join(__dirname, "weather", "upsert-dedup.test.js"));
const { runWeatherSyncStateTests } = require(path.join(__dirname, "weather", "sync-state.test.js"));
const { runGenerationVisibleWindowPriorityTests } = require(path.join(
  __dirname,
  "generation",
  "visible-window-priority.test.js"
));
const { runGenerationOverwriteSemanticsTests } = require(path.join(
  __dirname,
  "generation",
  "overwrite-semantics.test.js"
));
const { runGenerationBackgroundBackfillTests } = require(path.join(
  __dirname,
  "generation",
  "background-backfill.test.js"
));
const { runNoModeledFallbackTests } = require(path.join(__dirname, "rates", "no-modeled-fallback.test.js"));
const { runUnsupportedRegionTests } = require(path.join(__dirname, "rates", "unsupported-region.test.js"));
const { runRatesCadenceAvailabilityTests } = require(path.join(
  __dirname,
  "rates",
  "cadence-availability.test.js"
));
const { runRatesDayAheadCadenceTests } = require(path.join(__dirname, "rates", "day-ahead-cadence.test.js"));
const { runLocationChangeInvalidationTests } = require(path.join(
  __dirname,
  "invalidation",
  "location-change.test.js"
));
const { runRatesFingerprintConditionalTests } = require(path.join(
  __dirname,
  "invalidation",
  "rates-fingerprint-conditional.test.js"
));
const { runAssetChangeInvalidationTests } = require(path.join(
  __dirname,
  "invalidation",
  "asset-change.test.js"
));
const { runRatesPollingIntervalTests } = require(path.join(
  __dirname,
  "frontend",
  "rates-polling-interval.test.js"
));
const { runManualRefreshTriggersStatusTests } = require(path.join(
  __dirname,
  "frontend",
  "manual-refresh-triggers-status.test.js"
));
const { runCadenceControlsTests } = require(path.join(__dirname, "frontend", "cadence-controls.test.js"));
const { runBackfillScriptTests } = require(path.join(__dirname, "migration", "backfill-script.test.js"));
const { runNoRegressionSmokeTests } = require(path.join(__dirname, "migration", "no-regression-smoke.test.js"));
const { runEndpointsParityTests } = require(path.join(__dirname, "parity", "endpoints-parity.test.js"));
const { runResponseParityTests } = require(path.join(__dirname, "parity", "response-parity.test.js"));

const runDataUtilsTests = () => {
  assert.strictEqual(normalizeHeader(" GHI (W/m^2) "), "ghi");
  assert.strictEqual(normalizeHeader("\ufeffTemperature (C)"), "temperature");

  const solarHeaders = ["Timestamp", "GHI", "DNI", "DHI", "Air Temperature"];
  const solarMap = mapHeaders(solarHeaders, "solar");
  assert.deepStrictEqual(solarMap.indexByField, {
    timestamp: 0,
    ghi: 1,
    dni: 2,
    dhi: 3,
    air_temperature: 4,
  });

  const windHeaders = ["timestamp", "windspeed_100m", "temperature_100m", "pressure_100m"];
  const windMap = mapHeaders(windHeaders, "wind");
  assert.strictEqual(windMap.indexByField.timestamp, 0);
  assert.strictEqual(windMap.indexByField.windspeed_100m, 1);
  assert.strictEqual(windMap.indexByField.temperature_100m, 2);
  assert.strictEqual(windMap.indexByField.pressure_100m, 3);

  const solarSeries = [
    { timestamp: "2024-01-01T00:00:00Z", ghi: NaN, dni: 500, dhi: 100 },
    { timestamp: "2024-01-01T00:15:00Z", ghi: NaN, dni: 400, dhi: 80 },
  ];
  const windSeries = [
    { timestamp: "2024-01-01T00:15:00Z", windspeed_100m: NaN },
    { timestamp: "2024-01-01T00:30:00Z", windspeed_100m: 5 },
  ];

  const merged = mergeSeriesOnTimestamps(solarSeries, windSeries);
  assert.deepStrictEqual(merged.timestamps, ["2024-01-01T00:15:00.000Z"]);
  assert.strictEqual(merged.solar.length, 1);
  assert.strictEqual(merged.wind.length, 1);
  assert.strictEqual(merged.wind[0].windspeed_100m, 0);
  assert.strictEqual(merged.solar[0].ghi, 0);
};

const run = async () => {
  runDataUtilsTests();
  runSolarComputeTests();
  runWindComputeTests();
  runDbSchemaTests();
  runDbRlsTests();
  runDbConstraintTests();
  runSupabaseRequiredTests();
  runNoLocalDomainFallbackTests();
  await runV3ContractTests();
  await runV3ValidationTests();
  await runParityLocalVsServerlessTests();
  await runJobLifecycleTests();
  await runJobIdempotencyTests();
  await runJobRetryTests();
  await runWeatherRollingWindowTests();
  await runWeatherUpsertDedupTests();
  await runWeatherSyncStateTests();
  await runGenerationVisibleWindowPriorityTests();
  await runGenerationOverwriteSemanticsTests();
  await runGenerationBackgroundBackfillTests();
  await runNoModeledFallbackTests();
  await runUnsupportedRegionTests();
  await runRatesCadenceAvailabilityTests();
  await runRatesDayAheadCadenceTests();
  await runLocationChangeInvalidationTests();
  await runRatesFingerprintConditionalTests();
  await runAssetChangeInvalidationTests();
  runRatesPollingIntervalTests();
  runManualRefreshTriggersStatusTests();
  runCadenceControlsTests();
  await runBackfillScriptTests();
  await runNoRegressionSmokeTests();
  runEndpointsParityTests();
  await runResponseParityTests();
  console.log("All tests passed.");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
