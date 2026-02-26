const assert = require("assert");
const fs = require("fs");
const path = require("path");

const readMigration = () =>
  fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "migrations", "20260225_add_v3_sync_schema.sql"), "utf8");

const runDbConstraintTests = () => {
  const sql = readMigration();

  assert.ok(/provider in \('nrel', 'open_meteo'\)/i.test(sql), "Missing weather provider constraint.");
  assert.ok(/dataset in \('solar', 'wind'\)/i.test(sql), "Missing weather dataset constraint.");
  assert.ok(/domain in \('weather', 'generation', 'rates', 'storage'\)/i.test(sql), "Missing domain constraint.");
  assert.ok(/mode in \('rolling', 'full', 'visible_window'\)/i.test(sql), "Missing ingestion mode constraint.");
  assert.ok(/status in \('queued', 'running', 'completed', 'failed', 'cancelled'\)/i.test(sql), "Missing ingestion status constraint.");
  assert.ok(
    /requested_by in \('user_login', 'manual_refresh', 'nightly_cron', 'location_change', 'asset_change'\)/i.test(sql),
    "Missing requested_by constraint."
  );
  assert.ok(/alter column rates_source_fingerprint set not null/i.test(sql), "rates_source_fingerprint should be not null.");
};

module.exports = { runDbConstraintTests };

