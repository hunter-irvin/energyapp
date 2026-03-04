const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesPollingIntervalTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(source.includes("const RATES_SYNC_POLL_MS = 2 * 60 * 1000;"), "Expected 2-minute sync polling constant.");
  assert.ok(source.includes("const RATES_SYNC_ACTIVE_POLL_MS = 2 * 1000;"), "Expected 2-second active polling constant.");
  assert.ok(
    source.includes("backfillStatusTimer = window.setInterval(() => {") && source.includes("}, backfillStatusPollMs);"),
    "Expected polling interval to be centrally controlled by mutable interval state."
  );
  assert.ok(!source.includes("}, 5000);"), "Expected no hardcoded 5-second polling interval in rates page.");
};

module.exports = { runRatesPollingIntervalTests };
