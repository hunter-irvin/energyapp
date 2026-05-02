const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runLoadProfilesServiceTests = () => {
  const clientPath = path.join(__dirname, "..", "..", "public", "assets", "js", "core", "supabase-client.js");
  const clientSource = fs.readFileSync(clientPath, "utf8");

  ["toLoadProfileRow", "fromLoadProfileRow", "listLoadProfiles", "getLoadProfile", "upsertLoadProfile", "deleteLoadProfile"].forEach(
    (token) => {
      assert.ok(clientSource.includes(token), `Missing ${token} in Supabase client.`);
    }
  );

  const migrationPath = path.join(__dirname, "..", "..", "supabase", "migrations", "20260501_add_load_profiles.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.ok(/create table if not exists public\.load_profiles/i.test(migration), "Missing load_profiles table.");
  assert.ok(/project_id text not null references public\.projects\(id\) on delete cascade/i.test(migration), "Missing project FK cascade.");
  assert.ok(/model jsonb not null default '\{\}'::jsonb/i.test(migration), "Missing JSON model column.");
  assert.ok(/alter table public\.load_profiles enable row level security/i.test(migration), "Missing RLS enablement.");
  assert.ok(/create policy load_profiles_anon_all/i.test(migration), "Missing anon policy.");

  const bootstrap = fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "bootstrap.sql"), "utf8");
  assert.ok(/public\.load_profiles/i.test(bootstrap), "Bootstrap should include load_profiles.");
};

module.exports = { runLoadProfilesServiceTests };
