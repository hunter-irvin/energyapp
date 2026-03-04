const assert = require("assert");
const { buildCaisoRtFalseZeroRepairSql } = require("../../lib/v3/rates-zero-repair");

const runRatesCaisoRtZeroRepairTests = async () => {
  const dryRun = buildCaisoRtFalseZeroRepairSql({
    projectId: "1770839883041-6call5pg",
    windowStart: "2026-02-01T08:00:00.000Z",
    windowEnd: "2026-03-01T07:00:00.000Z",
    dryRun: true,
  });

  assert.ok(dryRun.sql.includes("from rate_project_series"));
  assert.ok(dryRun.sql.includes("market_mode = 'real_time'"));
  assert.ok(dryRun.sql.includes("source = 'rates_proxy_phase3_live_caiso_oasis'"));

  const repair = buildCaisoRtFalseZeroRepairSql({
    projectId: "1770839883041-6call5pg",
    windowStart: "2026-02-01T08:00:00.000Z",
    windowEnd: "2026-03-01T07:00:00.000Z",
  });

  assert.ok(repair.sql.startsWith("update rate_project_series"));
  assert.ok(repair.sql.includes("R13_FALSE_ZERO_REPAIRED_RT"));
};

module.exports = { runRatesCaisoRtZeroRepairTests };
