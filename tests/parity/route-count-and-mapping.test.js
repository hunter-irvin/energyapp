const assert = require("assert");
const fs = require("fs");
const path = require("path");

const REQUIRED_FUNCTION_FILES = [
  path.join("api", "[...path].js"),
  path.join("api", "v3-proxy.js"),
  path.join("api", "rates-proxy.js"),
  path.join("api", "weather-proxy.js"),
  path.join("api", "location-proxy.js"),
  path.join("api", "runtime-config.js"),
  path.join("api", "diagnostics.js"),
  path.join("api", "nrel-proxy.js"),
];

const runRouteCountAndMappingTests = () => {
  const repoRoot = path.join(__dirname, "..", "..");
  const apiDir = path.join(repoRoot, "api");

  const jsFunctions = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }
      if (entry.isFile() && entry.name.endsWith(".js")) {
        jsFunctions.push(path.relative(repoRoot, fullPath));
      }
    });
  };
  walk(apiDir);

  assert.ok(jsFunctions.length < 10, `Expected fewer than 10 deployed api functions, found ${jsFunctions.length}.`);

  REQUIRED_FUNCTION_FILES.forEach((file) => {
    assert.ok(jsFunctions.includes(file), `Missing required function entry: ${file}`);
  });

  const catchAllPath = path.join(repoRoot, "api", "[...path].js");
  const catchAllSource = fs.readFileSync(catchAllPath, "utf8");
  const routeMarkers = [
    'url.startsWith("/api/v3/sync/") && url.includes("/status")',
    'url.startsWith("/api/v3/sync/")',
    'url.startsWith("/api/v3/series/weather")',
    'url.startsWith("/api/v3/series/generation")',
    'url.startsWith("/api/v3/series/rates")',
    'url.startsWith("/api/v3/refresh")',
    'url.startsWith("/api/v3/cron/nightly-sync")',
    'url.startsWith("/api/v3/worker/run-once")',
    'url.startsWith("/api/rates/provider")',
    'url.startsWith("/api/rates/health")',
    'url.startsWith("/api/rates/timeseries")',
    'url.startsWith("/api/v2/rates/timeseries")',
    'url.startsWith("/api/weather-proxy")',
    'url.startsWith("/api/nrel-proxy")',
    'url.startsWith("/api/location/reverse")',
    'url === "/api/runtime-config"',
    'url === "/api/diagnostics"',
  ];

  routeMarkers.forEach((marker) => {
    assert.ok(catchAllSource.includes(marker), `Missing catch-all route mapping marker: ${marker}`);
  });
};

module.exports = { runRouteCountAndMappingTests };
