const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesWindowScopedPercentagesTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(source.includes("const getActiveChartWindowIso = () =>"), "Expected active chart window helper.");
  assert.ok(source.includes("start: chartWindow.start") && source.includes("end: chartWindow.end"), "Expected status polling scoped to chart window bounds.");
  assert.ok(source.includes("const activeWindow = getActiveChartWindowIso();") && source.includes("const windowStart = activeWindow.start;"), "Expected rates/health reads to use active chart window bounds.");
};

module.exports = { runRatesWindowScopedPercentagesTests };
