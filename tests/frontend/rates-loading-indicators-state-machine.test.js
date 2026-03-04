const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesLoadingIndicatorsStateMachineTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(source.includes("ratesChartFrame.setAttribute(\"data-state\", \"loading\")"), "Expected loading state application.");
  assert.ok(source.includes("ratesChartFrame.setAttribute(\"data-state\", \"warning\")"), "Expected warning state application.");
  assert.ok(source.includes("setLoading(true);"), "Expected loading start call in async flows.");
  assert.ok(source.includes("setLoading(false);"), "Expected loading clear call in async flows.");
  assert.ok(source.includes("Rates Sync: queued (waiting for worker; retrying automatically)"), "Expected stale-queue fallback status messaging.");
};

module.exports = { runRatesLoadingIndicatorsStateMachineTests };
