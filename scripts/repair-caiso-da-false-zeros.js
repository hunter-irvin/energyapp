#!/usr/bin/env node
const { buildCaisoFalseZeroRepairSql } = require("../lib/v3/rates-zero-repair");

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : null;
};

const projectId = getArg("--project-id");
const windowStart = getArg("--start");
const windowEnd = getArg("--end");
const marketMode = getArg("--market-mode") || "day_ahead";
const dryRun = args.includes("--dry-run") || !args.includes("--apply");

try {
  const { sql, params } = buildCaisoFalseZeroRepairSql({ projectId, windowStart, windowEnd, marketMode, dryRun });
  console.log(`-- CAISO ${marketMode.toUpperCase()} false-zero repair SQL`);
  console.log("-- Params:", JSON.stringify(params));
  console.log(sql);
  if (dryRun) {
    console.log("\n-- Dry run mode. Re-run with --apply to emit UPDATE SQL block.");
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
