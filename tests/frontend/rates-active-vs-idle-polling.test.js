const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesActiveVsIdlePollingTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(
    source.includes("const RATES_SYNC_ACTIVE_POLL_MS = 2 * 1000;"),
    "Expected fast active polling interval constant."
  );
  assert.ok(
    source.includes("let backfillStatusPollMs = RATES_SYNC_POLL_MS;"),
    "Expected mutable polling interval state."
  );
  assert.ok(source.includes("const setBackfillStatusPollingInterval = (intervalMs) =>"), "Expected polling interval helper.");
  assert.ok(
    source.includes("setBackfillStatusPollingInterval(isActiveJob ? RATES_SYNC_ACTIVE_POLL_MS : RATES_SYNC_POLL_MS);"),
    "Expected active vs idle polling switch based on job state."
  );
  assert.ok(
    source.includes("setBackfillStatusPollingInterval(RATES_SYNC_POLL_MS);"),
    "Expected polling to start/reset at idle interval."
  );
};

module.exports = { runRatesActiveVsIdlePollingTests };
