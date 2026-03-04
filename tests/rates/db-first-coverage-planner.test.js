const assert = require("assert");
const { buildDbFirstRatesPlan, RATE_CLASS_CONFIGS } = require("../../lib/v3/rates-sync");

const buildExpectedTs = (startIso, endIso, resolutionMinutes) => {
  const out = [];
  const stepMs = resolutionMinutes * 60 * 1000;
  for (let cursor = new Date(startIso).getTime(); cursor <= new Date(endIso).getTime(); cursor += stepMs) {
    out.push(new Date(cursor).toISOString());
  }
  return out;
};

const runDbFirstCoveragePlannerTests = async () => {
  const windowStart = "2026-02-20T00:00:00.000Z";
  const windowEnd = "2026-02-20T01:00:00.000Z";

  const store = {
    async readRateSeriesWindow({ serviceType, marketMode, resolutionMinutes }) {
      const tsValues = buildExpectedTs(windowStart, windowEnd, resolutionMinutes);
      return tsValues.map((ts) => ({ ts, value: 10, service_type: serviceType, market_mode: marketMode }));
    },
  };

  const plan = await buildDbFirstRatesPlan({
    projectId: "p-r2-full",
    windowStart,
    windowEnd,
    store,
  });

  assert.strictEqual(plan.hasMissingData, false);
  assert.strictEqual(plan.classes.length, RATE_CLASS_CONFIGS.length);
  plan.classes.forEach((entry) => {
    assert.strictEqual(entry.missingRanges.length, 0, `Expected no missing ranges for ${entry.key}.`);
    assert.strictEqual(entry.missingPoints, 0, `Expected no missing points for ${entry.key}.`);
    assert.strictEqual(entry.availablePoints, entry.expectedPoints, `Expected full coverage for ${entry.key}.`);
  });
  assert.strictEqual(plan.overall.missingPoints, 0);
};

module.exports = { runDbFirstCoveragePlannerTests };
