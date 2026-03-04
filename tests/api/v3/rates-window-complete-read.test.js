const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesWindowCompleteReadTests = () => {
  const filePath = path.join(__dirname, "..", "..", "..", "api", "v3-proxy.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(source.includes("const fetchAllRateSeriesRows = async"), "Expected paginated full-window rates series fetch helper.");
  assert.ok(source.includes("limit: String(pageSize)"), "Expected explicit page-size limit for iterative reads.");
  assert.ok(source.includes("cursorStart = new Date(lastMs + 1).toISOString()"), "Expected moving cursor to avoid repeated first-page truncation.");
  assert.ok(source.includes("const filtered = await fetchAllRateSeriesRows({"), "Expected rates series handler to use full-window iterative fetch.");
};

module.exports = { runRatesWindowCompleteReadTests };
