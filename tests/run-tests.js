const assert = require("assert");
const path = require("path");

global.window = {};
require(path.join(__dirname, "..", "public", "assets", "js", "core", "data-utils.js"));

const { normalizeHeader, mapHeaders, mergeSeriesOnTimestamps } = global.window.EnergyDataUtils;
const { runSolarComputeTests } = require(path.join(__dirname, "solar-compute.test.js"));
const { runWindComputeTests } = require(path.join(__dirname, "wind-compute.test.js"));
const { runSupabaseRequiredTests } = require(path.join(__dirname, "client", "supabase-required.test.js"));
const { runNoLocalDomainFallbackTests } = require(path.join(__dirname, "client", "no-local-domain-fallback.test.js"));
const { runLoadProfilesServiceTests } = require(path.join(__dirname, "client", "load-profiles-service.test.js"));
const { runLoadBuilderEngineTests } = require(path.join(__dirname, "frontend", "load-builder-engine.test.js"));
const { runLoadBuilderStaticTests } = require(path.join(__dirname, "frontend", "load-builder-static.test.js"));
const { runAiAssistantTests } = require(path.join(__dirname, "ai-assistant.test.js"));
const { runRatesV4UiStateTests } = require(path.join(__dirname, "frontend", "rates-v4-ui-state.test.js"));
const { runRatesV4CacheEngineTests } = require(path.join(__dirname, "frontend", "rates-v4-cache-engine.test.js"));
const { runWeatherCoverageEngineTests } = require(path.join(__dirname, "frontend", "weather-coverage-engine.test.js"));
const { runWeatherSyncBusTests } = require(path.join(__dirname, "frontend", "weather-sync-bus.test.js"));
const { runWeatherMapStateTests } = require(path.join(__dirname, "frontend", "weather-map-state.test.js"));
const { runV4RatesAggregationTests } = require(path.join(__dirname, "rates", "v4-aggregation.test.js"));
const { runV4RatesContractTests } = require(path.join(__dirname, "api", "v4", "rates-contracts.test.js"));
const { runV4ProviderRouteTests } = require(path.join(__dirname, "api", "v4", "provider-route.test.js"));
const { runV4SeriesRouteTests } = require(path.join(__dirname, "api", "v4", "series-route.test.js"));
const { runV4RoutesRetirementTests } = require(path.join(__dirname, "api", "v4", "routes-retirement.test.js"));
const { runWeatherProxyContractTests } = require(path.join(__dirname, "api", "weather-proxy-contracts.test.js"));

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
  runSupabaseRequiredTests();
  runNoLocalDomainFallbackTests();
  runLoadProfilesServiceTests();
  runLoadBuilderEngineTests();
  runLoadBuilderStaticTests();
  await runAiAssistantTests();
  runRatesV4UiStateTests();
  runRatesV4CacheEngineTests();
  runWeatherCoverageEngineTests();
  runWeatherSyncBusTests();
  runWeatherMapStateTests();
  runV4RatesAggregationTests();
  await runV4RatesContractTests();
  await runV4ProviderRouteTests();
  await runV4SeriesRouteTests();
  await runV4RoutesRetirementTests();
  runWeatherProxyContractTests();
  console.log("All tests passed.");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});


