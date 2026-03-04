const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesWindowMissingGapFetchTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(source.includes("const shouldTriggerVisibleWindowSync = (progressEntry) =>"), "Expected consolidated missing-data sync predicate.");
  assert.ok(source.includes("if (shouldTriggerVisibleWindowSync(progress))"), "Expected missing-point gate before sync enqueue.");
  assert.ok(source.includes("const activeWindow = getActiveChartWindowIso();"), "Expected gap fetch to use active chart window bounds.");
  assert.ok(
    source.includes("windowStart: activeWindow.start") && source.includes("windowEnd: activeWindow.end"),
    "Expected missing-gap sync request to be scoped to active window."
  );
};

module.exports = { runRatesWindowMissingGapFetchTests };
