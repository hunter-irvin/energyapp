const assert = require("assert");
const fs = require("fs");
const path = require("path");

const loadSqlCorpus = () => {
  const bootstrapPath = path.join(__dirname, "..", "..", "supabase", "bootstrap.sql");
  const migrationsDir = path.join(__dirname, "..", "..", "supabase", "migrations");
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const parts = [fs.readFileSync(bootstrapPath, "utf8")];
  migrationFiles.forEach((name) => {
    parts.push(fs.readFileSync(path.join(migrationsDir, name), "utf8"));
  });
  return parts.join("\n");
};

const assertContains = (sql, pattern, message) => {
  assert.ok(pattern.test(sql), message);
};

const runDbSchemaTests = () => {
  const sql = loadSqlCorpus();

  assertContains(sql, /create table if not exists public\.weather_project_series/i, "Missing weather_project_series table.");
  assertContains(sql, /create table if not exists public\.generation_project_series/i, "Missing generation_project_series table.");
  assertContains(sql, /create table if not exists public\.domain_sync_state/i, "Missing domain_sync_state table.");
  assertContains(sql, /create table if not exists public\.ingestion_jobs/i, "Missing ingestion_jobs table.");

  assertContains(sql, /alter table public\.projects[\s\S]*add column if not exists weather_fingerprint/i, "Missing projects.weather_fingerprint column.");
  assertContains(sql, /alter table public\.projects[\s\S]*add column if not exists asset_fingerprint/i, "Missing projects.asset_fingerprint column.");
  assertContains(sql, /alter table public\.projects[\s\S]*add column if not exists rates_source_fingerprint/i, "Missing projects.rates_source_fingerprint column.");

  assertContains(
    sql,
    /unique nulls not distinct \(project_id, provider, dataset, resolution_minutes, ts\)/i,
    "Missing weather_project_series unique key."
  );
  assertContains(
    sql,
    /unique nulls not distinct \(project_id, resolution_minutes, ts\)/i,
    "Missing generation_project_series unique key."
  );
  assertContains(
    sql,
    /create index if not exists ingestion_jobs_status_priority_idx/i,
    "Missing ingestion_jobs status/priority index."
  );
};

module.exports = { runDbSchemaTests };

