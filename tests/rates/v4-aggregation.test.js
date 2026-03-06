const assert = require("assert");
const path = require("path");
const { __internal } = require(path.join(__dirname, "..", "..", "api", "v4-rates-proxy.js"));

const runV4RatesAggregationTests = () => {
  const points = [
    { ts: "2026-03-01T00:00:00.000Z", value: 100, isForecast: false },
    { ts: "2026-03-01T00:05:00.000Z", value: null, isForecast: false },
    { ts: "2026-03-01T00:10:00.000Z", value: 200, isForecast: false },
    { ts: "2026-03-01T00:15:00.000Z", value: null, isForecast: false },
    { ts: "2026-03-01T00:20:00.000Z", value: 300, isForecast: false },
    { ts: "2026-03-01T00:25:00.000Z", value: null, isForecast: false },
  ];

  const halfHour = __internal.aggregatePoints(points, 30);
  assert.strictEqual(halfHour.length, 1, "Expected a single 30-min bucket.");
  assert.strictEqual(halfHour[0].value, 200, "Expected non-null-only partial average for bucket.");

  const allNull = __internal.aggregatePoints(
    [
      { ts: "2026-03-01T01:00:00.000Z", value: null },
      { ts: "2026-03-01T01:05:00.000Z", value: null },
    ],
    30
  );
  assert.strictEqual(allNull[0].value, null, "Expected all-null bucket to remain null.");

  const retrySeconds = __internal.parseRetryAfterSeconds({ upstreamErrorCode: "HTTP_429", upstreamError: "CAISO returned 429" });
  assert.strictEqual(retrySeconds, 5, "Expected default 429 retry countdown of 5 seconds.");
};

module.exports = { runV4RatesAggregationTests };
