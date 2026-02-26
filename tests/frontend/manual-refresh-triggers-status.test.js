const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runManualRefreshTriggersStatusTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");
  assert.ok(source.includes("await fetch(V3_REFRESH_ENDPOINT"), "Expected manual refresh to hit v3 refresh endpoint.");
  assert.ok(source.includes("reason: \"manual_refresh\""), "Expected manual refresh request reason.");
  assert.ok(
    source.includes("await fetchBackfillStatus();"),
    "Expected manual refresh flow to trigger immediate sync status refresh."
  );
  assert.ok(
    source.includes("window.addEventListener(\"focus\", () => {\n      void fetchBackfillStatus();\n    });"),
    "Expected focus event to trigger status refresh."
  );
};

module.exports = { runManualRefreshTriggersStatusTests };
