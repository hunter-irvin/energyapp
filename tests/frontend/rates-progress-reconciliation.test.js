const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesProgressReconciliationTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(source.includes("seriesCoverageByFeed"), "Expected series coverage cache on view state.");
  assert.ok(source.includes("getHealthRowCoveragePct"), "Expected health-row coverage fallback helper.");
  assert.ok(source.includes("getSeriesCoveragePct"), "Expected series-based coverage fallback helper.");
  assert.ok(
    source.includes("Math.max(getSeriesCoveragePct(feedKey), getHealthRowCoveragePct(feedKey))"),
    "Expected reconciled coverage fallback between series and status/health sources."
  );
};

module.exports = { runRatesProgressReconciliationTests };
