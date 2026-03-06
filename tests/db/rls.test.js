const assert = require("assert");
const fs = require("fs");
const path = require("path");

const readMigration = () =>
  fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "migrations", "20260225_add_v3_sync_schema.sql"), "utf8");

const runDbRlsTests = () => {
  const sql = readMigration();

  assert.ok(/alter table public\.weather_project_series enable row level security/i.test(sql));
  assert.ok(/alter table public\.generation_project_series enable row level security/i.test(sql));
  assert.ok(/alter table public\.domain_sync_state enable row level security/i.test(sql));
  assert.ok(/alter table public\.ingestion_jobs enable row level security/i.test(sql));

  assert.ok(/create policy weather_project_series_anon_all/i.test(sql));
  assert.ok(/create policy generation_project_series_anon_all/i.test(sql));
  assert.ok(/create policy domain_sync_state_anon_all/i.test(sql));
  assert.ok(/create policy ingestion_jobs_anon_all/i.test(sql));
};

module.exports = { runDbRlsTests };

