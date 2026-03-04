const assert = require("assert");
const { buildDbFirstRatesPlan } = require("../../lib/v3/rates-sync");

const runMissingRangeChunkingTests = async () => {
  const windowStart = "2026-02-20T00:00:00.000Z";
  const windowEnd = "2026-02-20T01:00:00.000Z";

  const existingByClass = {
    "lmp:real_time": [
      "2026-02-20T00:00:00.000Z",
      "2026-02-20T00:05:00.000Z",
      "2026-02-20T00:10:00.000Z",
      "2026-02-20T00:15:00.000Z",
      "2026-02-20T00:30:00.000Z",
      "2026-02-20T00:35:00.000Z",
      "2026-02-20T00:40:00.000Z",
      "2026-02-20T00:45:00.000Z",
      "2026-02-20T00:50:00.000Z",
      "2026-02-20T00:55:00.000Z",
      "2026-02-20T01:00:00.000Z",
    ],
    "lmp:day_ahead": ["2026-02-20T00:00:00.000Z"],
    "tariff:tariff": ["2026-02-20T00:00:00.000Z", "2026-02-20T01:00:00.000Z"],
  };

  const store = {
    async readRateSeriesWindow({ serviceType, marketMode }) {
      const key = `${serviceType}:${marketMode}`;
      return (existingByClass[key] || []).map((ts) => ({ ts, value: 10 }));
    },
  };

  const plan = await buildDbFirstRatesPlan({
    projectId: "p-r2-partial",
    windowStart,
    windowEnd,
    store,
  });

  const rtPlan = plan.classes.find((entry) => entry.key === "lmp_rt");
  const daPlan = plan.classes.find((entry) => entry.key === "lmp_da");
  const tariffPlan = plan.classes.find((entry) => entry.key === "tariff");

  assert.ok(rtPlan);
  assert.ok(daPlan);
  assert.ok(tariffPlan);

  assert.strictEqual(rtPlan.missingRanges.length, 1, "Expected one missing RT gap.");
  assert.strictEqual(rtPlan.missingRanges[0].startIso, "2026-02-20T00:20:00.000Z");
  assert.strictEqual(rtPlan.missingRanges[0].endIso, "2026-02-20T00:25:00.000Z");

  assert.strictEqual(daPlan.missingRanges.length, 1, "Expected one missing DA point.");
  assert.strictEqual(daPlan.missingRanges[0].startIso, "2026-02-20T01:00:00.000Z");
  assert.strictEqual(daPlan.missingRanges[0].endIso, "2026-02-20T01:00:00.000Z");

  assert.strictEqual(tariffPlan.missingRanges.length, 0, "Expected no missing tariff ranges.");
  assert.strictEqual(plan.hasMissingData, true);
};

module.exports = { runMissingRangeChunkingTests };
