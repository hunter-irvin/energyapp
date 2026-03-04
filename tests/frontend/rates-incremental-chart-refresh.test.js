const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesIncrementalChartRefreshTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(
    source.includes("const buildActiveFeedProgressSignature = ({ progressByFeed, activeFeedKey, windowStart, windowEnd }) =>"),
    "Expected active-feed signature helper."
  );
  assert.ok(
    source.includes("const shouldRefreshSeries = isActiveJob && nextSignature !== lastActiveFeedProgressSignature;"),
    "Expected refresh trigger to depend on active progress signature changes."
  );
  assert.ok(
    source.includes("if (shouldRefreshSeries && !incrementalRefreshInFlight) {"),
    "Expected in-flight guard around incremental refresh."
  );
  assert.ok(
    source.includes("await fetchRatesSeries({ forceRefresh: false, suppressRender: false }).catch(() => {});"),
    "Expected incremental chart refresh call during active sync."
  );
};

module.exports = { runRatesIncrementalChartRefreshTests };
