const assert = require("assert");
const path = require("path");

const loadWeatherMapState = () => {
  const previousWindow = global.window;
  global.window = {};
  delete require.cache[require.resolve(path.join(__dirname, "..", "..", "public", "assets", "js", "features", "weather-map-state.js"))];
  require(path.join(__dirname, "..", "..", "public", "assets", "js", "features", "weather-map-state.js"));
  const api = global.window.EnergyWeatherMapState;
  global.window = previousWindow;
  return api;
};

const runWeatherMapStateTests = () => {
  const mapState = loadWeatherMapState();

  assert.strictEqual(mapState.normalizeMapMode("satellite"), "satellite");
  assert.strictEqual(mapState.normalizeMapMode("street"), "street");
  assert.strictEqual(mapState.normalizeMapMode("3d"), "3d");
  assert.strictEqual(mapState.normalizeMapMode("terrain"), "3d");
  assert.strictEqual(mapState.normalizeMapMode(null), "3d");

  assert.deepStrictEqual(mapState.normalizeCameraState({ mode: "3d", pitch: "48", bearing: "-22" }), {
    mode: "3d",
    pitch: 48,
    bearing: -22,
  });
  assert.deepStrictEqual(mapState.normalizeCameraState({ mode: "bad", pitch: "nope", bearing: null }), {
    mode: "3d",
    pitch: 55,
    bearing: 0,
  });
};

module.exports = { runWeatherMapStateTests };
