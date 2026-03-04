const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesNullSafetyFeedbackTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(
    source.includes("Array.isArray(viewState.rawPoints) && viewState.rawPoints.length > 0"),
    "Expected applyChartFeedbackState to use null-safe rawPoints readiness check."
  );
  assert.ok(
    !source.includes("viewState.displaySeries.length"),
    "Expected removal of unsafe viewState.displaySeries.length access."
  );
  assert.ok(source.includes("normalizeProgressEntry"), "Expected progress normalization helper for null safety.");
};

module.exports = { runRatesNullSafetyFeedbackTests };
