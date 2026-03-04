const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesGapTriggersVisibleWindowSyncTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(source.includes("const reloadWindowScopedData = async"), "Expected window-scoped reload path.");
  assert.ok(source.includes("const shouldTriggerVisibleWindowSync = (progressEntry) =>"), "Expected shared missing-data sync predicate.");
  assert.ok(source.includes("if (shouldTriggerVisibleWindowSync(progress))"), "Expected sync trigger to use progress+coverage predicate.");
  assert.ok(
    source.includes("mode: \"visible_window\"") && source.includes("windowStart: activeWindow.start") && source.includes("windowEnd: activeWindow.end"),
    "Expected missing-gap retrieval to enqueue visible-window sync for active chart bounds."
  );
};

module.exports = { runRatesGapTriggersVisibleWindowSyncTests };
