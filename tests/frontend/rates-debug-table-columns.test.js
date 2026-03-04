const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesDebugTableColumnsTests = () => {
  const htmlPath = path.join(__dirname, "..", "..", "public", "projects", "rates.html");
  const source = fs.readFileSync(htmlPath, "utf8");

  const matches = source.match(/<th>Data Availability<\/th>/g) || [];
  assert.strictEqual(matches.length, 3, "Expected Data Availability columns for Tariff, LMP-RT, and LMP-DA.");
  assert.ok(!source.includes("<th>Source</th>"), "Expected Source columns to be removed from debug table header.");
};

module.exports = { runRatesDebugTableColumnsTests };
