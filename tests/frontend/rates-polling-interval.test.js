const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesPollingIntervalTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");
  assert.ok(source.includes("const RATES_SYNC_POLL_MS = 2 * 60 * 1000;"), "Expected 2-minute sync polling constant.");
  assert.ok(
    source.includes("backfillStatusTimer = window.setInterval(() => {\n      void fetchBackfillStatus();\n    }, RATES_SYNC_POLL_MS);"),
    "Expected rates sync polling interval to use 2-minute constant."
  );
  assert.ok(!source.includes("}, 5000);"), "Expected no 5-second polling interval in rates page.");
};

module.exports = { runRatesPollingIntervalTests };
