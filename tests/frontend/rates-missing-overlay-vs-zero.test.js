const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesMissingOverlayVsZeroTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(
    source.includes("const isMissing = series[i]?.value == null;"),
    "Expected missing-overlay logic to classify null/undefined values as missing."
  );
  assert.ok(
    source.includes("missingReason") || source.includes("Missing data"),
    "Expected rates chart to retain explicit missing-data rendering path."
  );
};

module.exports = { runRatesMissingOverlayVsZeroTests };
