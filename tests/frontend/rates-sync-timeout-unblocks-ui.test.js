const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesSyncTimeoutUnblocksUiTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(source.includes("RATES_SYNC_REQUEST_TIMEOUT_MS"), "Expected explicit sync timeout constant.");
  assert.ok(source.includes("new AbortController()"), "Expected AbortController usage for sync timeout abort.");
  assert.ok(source.includes("Rates sync request timed out."), "Expected explicit timeout error message.");
  assert.ok(
    /manualRefreshAllRateFeeds[\s\S]*finally \{\r?\n\s*setLoading\(false\);\r?\n\s*\}/.test(source),
    "Expected manual refresh to always clear loading state in finally."
  );
};

module.exports = { runRatesSyncTimeoutUnblocksUiTests };
