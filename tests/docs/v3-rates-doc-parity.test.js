const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (relativePath) => fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");

const runV3RatesDocParityTests = () => {
  const readme = read("README.md");
  const architecture = read("docs/architecture.md");
  const rates = read("docs/rates.md");
  const playbook = read("docs/v3-sync-migration-playbook.md");

  assert.ok(
    readme.includes("Rates Page (Current v3 DB-First Progressive Sync)"),
    "README should describe the current v3 DB-first progressive rates flow."
  );
  assert.ok(
    !readme.includes("/api/rates/backfill/start") && !readme.includes("/api/rates/backfill/status"),
    "README should not document legacy backfill routes as active endpoints."
  );

  assert.ok(
    architecture.includes("api/[...path].js"),
    "Architecture doc should reflect catch-all serverless routing."
  );
  assert.ok(
    architecture.includes("rate_sync_chunks"),
    "Architecture doc should include rate_sync_chunks as canonical v3 persistence."
  );

  assert.ok(
    rates.includes("active/running job: fast polling (`2s`)") && rates.includes("normal polling (`120s`)"),
    "Rates doc should describe active vs idle polling cadence."
  );
  assert.ok(
    rates.includes("Data Availability") && rates.includes("green") && rates.includes("yellow") && rates.includes("gray"),
    "Rates doc should describe Data Availability bars and segment semantics."
  );
  assert.ok(
    /no modeled fallback/i.test(rates),
    "Rates doc should explicitly state no modeled fallback behavior."
  );

  assert.ok(
    playbook.includes("2s while active job chunks are running") && playbook.includes("120s when idle/completed"),
    "Migration playbook should reflect dynamic polling behavior."
  );
  assert.ok(
    playbook.includes("tests/parity/route-count-and-mapping.test.js") &&
      playbook.includes("tests/parity/local-vs-serverless-routes.test.js"),
    "Migration playbook should reflect current parity tests used for consolidated routing."
  );
};

module.exports = { runV3RatesDocParityTests };

