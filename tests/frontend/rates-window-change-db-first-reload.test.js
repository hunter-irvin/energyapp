const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesWindowChangeDbFirstReloadTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(source.includes("const reloadWindowScopedData = async () =>"), "Expected window-scoped reload helper.");
  assert.ok(source.includes("await fetchRatesSeries({ forceRefresh: false });"), "Expected DB-first series reload on window changes.");
  assert.ok(source.includes("void reloadWindowScopedData();"), "Expected controls to trigger window-scoped reload.");
};

module.exports = { runRatesWindowChangeDbFirstReloadTests };
