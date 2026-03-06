const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runNoLocalDomainFallbackTests = () => {
  const clientPath = path.join(__dirname, "..", "..", "public", "assets", "js", "core", "supabase-client.js");
  const source = fs.readFileSync(clientPath, "utf8");

  const forbiddenTokens = [
    "const localDb = {",
    "energyapp.db.projects",
    "energyapp.db.assets",
    "energyapp.db.weatherCache",
    "energyapp.db.rateSeriesCache",
    "energyapp.db.rateRegionHealth",
    "energyapp.db.rateIngestRuns",
    "localStorage (fallback)",
  ];

  forbiddenTokens.forEach((token) => {
    assert.ok(!source.includes(token), `Unexpected local fallback token present: ${token}`);
  });
};

module.exports = { runNoLocalDomainFallbackTests };

