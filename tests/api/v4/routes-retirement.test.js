const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runV4RoutesRetirementTests = async () => {
  const repoRoot = path.join(__dirname, "..", "..", "..");

  assert.strictEqual(
    fs.existsSync(path.join(repoRoot, "api", "[...path].js")),
    false,
    "Expected catch-all dispatcher to be retired from production routing."
  );
  assert.strictEqual(
    fs.existsSync(path.join(repoRoot, "api", "v4-rates-proxy.js")),
    false,
    "Expected v4 rates proxy entrypoint to be retired from production routing."
  );
  assert.strictEqual(
    fs.existsSync(path.join(repoRoot, "api", "rates")),
    false,
    "Expected prototype /api/rates routes to remain retired."
  );
  assert.strictEqual(
    fs.existsSync(path.join(repoRoot, "api", "v3")),
    false,
    "Expected prototype /api/v3 routes to remain retired."
  );
};

module.exports = { runV4RoutesRetirementTests };
