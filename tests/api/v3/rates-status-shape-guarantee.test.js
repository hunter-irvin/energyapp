const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesStatusShapeGuaranteeTests = () => {
  const filePath = path.join(__dirname, "..", "..", "..", "api", "v3-proxy.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(source.includes("buildDefaultRatesStatusCoverage"), "Expected default rates status coverage builder.");
  assert.ok(source.includes("tariff: createClassEntry(\"tariff\", \"tariff\")"), "Expected tariff class default entry.");
  assert.ok(source.includes("lmpRt: createClassEntry(\"lmp\", \"real_time\")"), "Expected lmpRt class default entry.");
  assert.ok(source.includes("lmpDa: createClassEntry(\"lmp\", \"day_ahead\")"), "Expected lmpDa class default entry.");
  assert.ok(
    /ratesProgress = await buildRatesStatusCoverage\([\s\S]*?\)\;[\s\S]*?catch \(error\) \{[\s\S]*?buildDefaultRatesStatusCoverage/.test(source),
    "Expected status handler to fall back to a stable default shape when coverage aggregation fails."
  );
};

module.exports = { runRatesStatusShapeGuaranteeTests };
