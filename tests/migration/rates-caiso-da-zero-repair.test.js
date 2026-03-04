const assert = require("assert");
const { buildCaisoDaFalseZeroRepairSql } = require("../../lib/v3/rates-zero-repair");

const runRatesCaisoDaZeroRepairTests = async () => {
  const dryRun = buildCaisoDaFalseZeroRepairSql({
    projectId: "1770839883041-6call5pg",
    windowStart: "2026-02-01T08:00:00.000Z",
    windowEnd: "2026-03-01T07:00:00.000Z",
    dryRun: true,
  });

  assert.ok(dryRun.sql.includes("from rate_project_series"));
  assert.ok(dryRun.sql.includes("source = 'rates_proxy_phase3_live_caiso_oasis'"));
  assert.ok(dryRun.sql.includes("market_mode = 'day_ahead'"));
  assert.ok(dryRun.sql.includes("value = 0"));
  assert.deepStrictEqual(dryRun.params.length, 3);

  const repair = buildCaisoDaFalseZeroRepairSql({
    projectId: "1770839883041-6call5pg",
    windowStart: "2026-02-01T08:00:00.000Z",
    windowEnd: "2026-03-01T07:00:00.000Z",
  });

  assert.ok(repair.sql.startsWith("update rate_project_series"));
  assert.ok(repair.sql.includes("value = null"));
  assert.ok(repair.sql.includes("R12_FALSE_ZERO_REPAIRED_DA"));

  assert.throws(
    () => buildCaisoDaFalseZeroRepairSql({ projectId: "", windowStart: "2026-01-01", windowEnd: "2026-01-02" }),
    /projectId is required/
  );
};

module.exports = { runRatesCaisoDaZeroRepairTests };
