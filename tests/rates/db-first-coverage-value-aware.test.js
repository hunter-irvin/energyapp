const assert = require("assert");
const { buildDbFirstRatesPlan } = require("../../lib/v3/rates-sync");

const buildExpectedTs = (startIso, endIso, resolutionMinutes) => {
  const out = [];
  const stepMs = resolutionMinutes * 60 * 1000;
  for (let cursor = new Date(startIso).getTime(); cursor <= new Date(endIso).getTime(); cursor += stepMs) {
    out.push(new Date(cursor).toISOString());
  }
  return out;
};

const runDbFirstCoverageValueAwareTests = async () => {
  const windowStart = "2026-02-01T00:00:00.000Z";
  const windowEnd = "2026-02-01T02:00:00.000Z";

  const store = {
    async readRateSeriesWindow({ resolutionMinutes }) {
      const tsValues = buildExpectedTs(windowStart, windowEnd, resolutionMinutes);
      return tsValues.map((ts, idx) => ({ ts, value: idx === 0 ? 0 : idx === 1 ? null : 12.5 }));
    },
  };

  const plan = await buildDbFirstRatesPlan({
    projectId: "p-r12-value-aware",
    windowStart,
    windowEnd,
    store,
  });

  const dayAhead = plan.classes.find((entry) => entry.key === "lmp_da");
  assert.ok(dayAhead, "Expected lmp_da class in plan.");
  assert.strictEqual(dayAhead.expectedPoints, 3);
  assert.strictEqual(dayAhead.availablePoints, 2, "Expected only finite numeric values (including 0) to count as available.");
  assert.strictEqual(dayAhead.missingPoints, 1);
  assert.strictEqual(dayAhead.needsFetch, true);
};

module.exports = { runDbFirstCoverageValueAwareTests };
