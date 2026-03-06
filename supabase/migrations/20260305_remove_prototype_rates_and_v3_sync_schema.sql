-- Remove prototype rates/v3 sync schema now that v4 rates is the only active flow.

alter table if exists public.projects
  drop column if exists rates_service_type,
  drop column if exists rates_market_mode,
  drop column if exists rates_source_fingerprint,
  drop column if exists weather_fingerprint,
  drop column if exists asset_fingerprint,
  drop column if exists last_login_sync_at,
  drop column if exists last_nightly_sync_at,
  drop column if exists location_fingerprint;

drop table if exists public.rate_sync_chunks cascade;
drop table if exists public.rate_backfill_jobs cascade;
drop table if exists public.rate_project_series cascade;
drop table if exists public.rate_region_health cascade;
drop table if exists public.rate_series_cache cascade;
drop table if exists public.rate_ingest_runs cascade;

drop table if exists public.domain_sync_state cascade;
drop table if exists public.ingestion_jobs cascade;
drop table if exists public.weather_project_series cascade;
drop table if exists public.generation_project_series cascade;
