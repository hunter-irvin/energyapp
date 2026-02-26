const assert = require("assert");
const fs = require("fs");
const path = require("path");

const V3_ROUTE_MARKERS = [
  'req.url.startsWith("/api/v3/sync/") && req.url.includes("/status")',
  'req.url.startsWith("/api/v3/sync/")',
  'req.url.startsWith("/api/v3/series/weather")',
  'req.url.startsWith("/api/v3/series/generation")',
  'req.url.startsWith("/api/v3/series/rates")',
  'req.url.startsWith("/api/v3/refresh")',
  'req.url.startsWith("/api/v3/cron/nightly-sync")',
  'req.url.startsWith("/api/v3/worker/run-once")',
];

const WRAPPER_ENTRIES = [
  { label: "sync-domain", file: path.join(__dirname, "..", "..", "api", "v3", "sync", "[domain].js") },
  { label: "sync-status", file: path.join(__dirname, "..", "..", "api", "v3", "sync", "[domain]", "status.js") },
  { label: "series-weather", file: path.join(__dirname, "..", "..", "api", "v3", "series", "weather.js") },
  { label: "series-generation", file: path.join(__dirname, "..", "..", "api", "v3", "series", "generation.js") },
  { label: "series-rates", file: path.join(__dirname, "..", "..", "api", "v3", "series", "rates.js") },
  { label: "refresh", file: path.join(__dirname, "..", "..", "api", "v3", "refresh.js") },
  { label: "cron-nightly-sync", file: path.join(__dirname, "..", "..", "api", "v3", "cron", "nightly-sync.js") },
  { label: "worker-run-once", file: path.join(__dirname, "..", "..", "api", "v3", "worker", "run-once.js") },
];

const runEndpointsParityTests = () => {
  const serverPath = path.join(__dirname, "..", "..", "server.js");
  const serverSource = fs.readFileSync(serverPath, "utf8");

  V3_ROUTE_MARKERS.forEach((marker) => {
    assert.ok(serverSource.includes(marker), `Missing v3 route marker in server.js: ${marker}`);
  });

  WRAPPER_ENTRIES.forEach((entry) => {
    assert.ok(fs.existsSync(entry.file), `Missing deployed wrapper file for ${entry.label}.`);
    delete require.cache[require.resolve(entry.file)];
    const exported = require(entry.file);
    assert.strictEqual(typeof exported, "function", `Wrapper ${entry.label} must export a handler function.`);
  });
};

module.exports = { runEndpointsParityTests };
