const assert = require("assert");
const path = require("path");

global.window = {};
require(path.join(__dirname, "..", "data-utils.js"));

const { normalizeHeader, mapHeaders, mergeSeriesOnTimestamps } = global.window.EnergyDataUtils;

const run = () => {
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

run();
console.log("All tests passed.");
