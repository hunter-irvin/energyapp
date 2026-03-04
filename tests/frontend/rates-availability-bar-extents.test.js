const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesAvailabilityBarExtentsTests = () => {
  const ratesPath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const cssPath = path.join(__dirname, "..", "..", "public", "assets", "css", "styles.css");
  const ratesSource = fs.readFileSync(ratesPath, "utf8");
  const cssSource = fs.readFileSync(cssPath, "utf8");

  assert.ok(ratesSource.includes("rates-availability__extents"), "Expected extent labels container in availability markup.");
  assert.ok(ratesSource.includes("state.windowStartLabel") && ratesSource.includes("state.windowEndLabel"), "Expected start/end labels for extent display.");
  assert.ok(cssSource.includes(".rates-availability__extents"), "Expected CSS styles for availability extent labels.");
};

module.exports = { runRatesAvailabilityBarExtentsTests };
