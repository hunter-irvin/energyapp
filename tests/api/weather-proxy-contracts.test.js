const assert = require("assert");
const path = require("path");

const weatherProxy = require(path.join(__dirname, "..", "..", "api", "weather-proxy.js"));

const runWeatherProxyContractTests = () => {
  const internal = weatherProxy.__internal || {};
  const {
    parseOpenMeteoRangeLimit,
    buildCoverageWindowFromRows,
    buildCoverageGaps,
    withOpenMeteoMeta,
    OpenMeteoRangeLimitError,
  } = internal;

  assert.strictEqual(typeof parseOpenMeteoRangeLimit, "function", "Expected parseOpenMeteoRangeLimit helper.");
  assert.strictEqual(typeof withOpenMeteoMeta, "function", "Expected withOpenMeteoMeta helper.");

  const parsedRange = parseOpenMeteoRangeLimit(
    "Parameter 'end_date' is out of allowed range from 2025-12-02 to 2026-03-20"
  );
  assert.deepStrictEqual(parsedRange, { minDate: "2025-12-02", maxDate: "2026-03-20" });

  const rows = [
    { normalized_timestamp: "2026-02-10T00:00:00.000Z" },
    { normalized_timestamp: "2026-02-10T00:30:00.000Z" },
    { normalized_timestamp: "2026-02-10T01:00:00.000Z" },
  ];
  const servedWindow = buildCoverageWindowFromRows(rows);
  assert.strictEqual(servedWindow.start, "2026-02-10T00:00:00.000Z");
  assert.strictEqual(servedWindow.end, "2026-02-10T01:00:00.000Z");

  const meta = withOpenMeteoMeta({
    baseMeta: { provider: "open_meteo" },
    records: rows,
    requestedStartDate: "2026-02-09",
    requestedEndDate: "2026-02-11",
    expansionTier: "tier_1m",
    runId: "run_abc",
    rangeLimit: null,
  });

  assert.strictEqual(meta.expansionTier, "tier_1m");
  assert.strictEqual(meta.runId, "run_abc");
  assert.ok(meta.requestedWindow?.start, "Expected requestedWindow.start");
  assert.ok(meta.servedWindow?.start, "Expected servedWindow.start");
  assert.ok(meta.coverageWindow?.end, "Expected coverageWindow.end");
  assert.ok(Array.isArray(meta.coverageGaps), "Expected coverageGaps array");

  const gaps = buildCoverageGaps({
    requestedWindow: {
      start: "2026-02-09T00:00:00.000Z",
      end: "2026-02-11T23:59:59.000Z",
    },
    servedWindow: {
      start: "2026-02-10T00:00:00.000Z",
      end: "2026-02-10T23:30:00.000Z",
    },
  });
  assert.ok(gaps.length >= 2, "Expected before/after coverage gaps for partial served window.");

  const rangeErr = new OpenMeteoRangeLimitError("range", { minDate: "2025-12-02", maxDate: "2026-03-20" }, 400);
  assert.strictEqual(rangeErr.code, "OPEN_METEO_RANGE_LIMIT");
  assert.strictEqual(rangeErr.statusCode, 400);
};

module.exports = { runWeatherProxyContractTests };
