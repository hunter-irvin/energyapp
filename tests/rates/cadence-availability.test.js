const assert = require("assert");
const { __internal } = require("../../lib/rates/lmp-adapters");

const runRatesCadenceAvailabilityTests = async () => {
  const fiveMinuteRows = [
    { ts: "2026-02-01T00:00:00.000Z", value: 1 },
    { ts: "2026-02-01T00:05:00.000Z", value: 2 },
    { ts: "2026-02-01T00:10:00.000Z", value: 3 },
  ];
  const hourlyRows = [
    { ts: "2026-02-01T00:00:00.000Z", value: 1 },
    { ts: "2026-02-01T01:00:00.000Z", value: 2 },
  ];

  assert.strictEqual(__internal.inferResolutionFromRows(fiveMinuteRows, 60), 5);
  assert.strictEqual(__internal.inferResolutionFromRows(hourlyRows, 60), 60);
};

module.exports = { runRatesCadenceAvailabilityTests };
