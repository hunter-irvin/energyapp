const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesAvailabilityBarsTests = () => {
  const jsPath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const cssPath = path.join(__dirname, "..", "..", "public", "assets", "css", "styles.css");

  const jsSource = fs.readFileSync(jsPath, "utf8");
  const cssSource = fs.readFileSync(cssPath, "utf8");

  assert.ok(jsSource.includes("buildDataAvailabilityCell"), "Expected data-availability cell renderer.");
  assert.ok(jsSource.includes("rates-availability__segment--db"), "Expected DB segment class usage.");
  assert.ok(jsSource.includes("rates-availability__segment--active"), "Expected active segment class usage.");
  assert.ok(jsSource.includes("rates-availability__segment--pending"), "Expected pending segment class usage.");

  assert.ok(cssSource.includes(".rates-availability"), "Expected availability bar container styles.");
  assert.ok(cssSource.includes(".rates-availability__segment--db"), "Expected DB segment style.");
  assert.ok(cssSource.includes(".rates-availability__segment--active"), "Expected active segment style.");
  assert.ok(cssSource.includes(".rates-availability__segment--pending"), "Expected pending segment style.");
};

module.exports = { runRatesAvailabilityBarsTests };
