const assert = require("assert");
const path = require("path");

const runWeatherCoverageEngineTests = () => {
  global.window = global.window || {};
  require(path.join(__dirname, "..", "..", "public", "assets", "js", "features", "weather-coverage-engine.js"));

  const engine = global.window.EnergyWeatherCoverage;
  assert.ok(engine, "Expected EnergyWeatherCoverage module to register on window.");

  const baseRecords = [
    { normalized_timestamp: "2026-02-01T00:00:00.000Z", ghi: "1" },
    { normalized_timestamp: "2026-02-01T00:30:00.000Z", ghi: "2" },
  ];
  const incomingRecords = [
    { normalized_timestamp: "2026-02-01T00:30:00.000Z", ghi: "9" },
    { normalized_timestamp: "2026-02-01T01:00:00.000Z", ghi: "3" },
  ];

  const merged = engine.mergeRecordsByTimestamp(baseRecords, incomingRecords);
  assert.strictEqual(merged.length, 3, "Expected dedupe by normalized timestamp.");
  assert.strictEqual(merged[1].ghi, "9", "Expected incoming record to overwrite matching timestamp.");

  const covered = engine.isWindowCovered(
    merged,
    "2026-02-01T00:00:00.000Z",
    "2026-02-01T01:00:00.000Z",
    30
  );
  assert.strictEqual(covered, true, "Expected contiguous half-hour points to report covered.");

  const partial = engine.extractWindowRecords(
    merged,
    "2026-02-01T00:30:00.000Z",
    "2026-02-01T01:00:00.000Z"
  );
  assert.strictEqual(partial.length, 2);

  const withGap = [
    { normalized_timestamp: "2026-02-01T00:00:00.000Z" },
    { normalized_timestamp: "2026-02-01T01:00:00.000Z" },
  ];
  const gaps = engine.computeCoverageGaps(
    withGap,
    "2026-02-01T00:00:00.000Z",
    "2026-02-01T01:00:00.000Z",
    30
  );
  assert.ok(gaps.length >= 1, "Expected at least one missing gap for skipped 00:30 point.");

  const envelope = engine.buildCoverageEnvelope(
    merged,
    "2026-02-01T00:00:00.000Z",
    "2026-02-01T01:00:00.000Z"
  );
  assert.strictEqual(envelope.schema, engine.WEATHER_ENGINE_SCHEMA);
  assert.ok(envelope.requestedWindow?.start);
  assert.ok(envelope.coverageWindow?.end);
};

module.exports = { runWeatherCoverageEngineTests };
