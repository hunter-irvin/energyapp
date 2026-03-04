const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runManualRefreshTriggersStatusTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");
  assert.ok(
    source.includes("await requestRatesSync({ runNow: true, mode: \"rolling\" })"),
    "Expected manual refresh to invoke v3 rates sync directly."
  );
  assert.ok(source.includes("runNow ? \"manual_refresh\" : \"user_login\""), "Expected manual refresh request reason.");
  assert.ok(
    source.includes("await fetchBackfillStatus();"),
    "Expected manual refresh flow to trigger immediate sync status refresh."
  );
  assert.ok(
    /window\.addEventListener\("focus", \(\) => \{\r?\n\s*void fetchBackfillStatus\(\);\r?\n\s*\}\);/.test(source),
    "Expected focus event to trigger status refresh."
  );
};

module.exports = { runManualRefreshTriggersStatusTests };
