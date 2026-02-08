-- Merchant BESS Arbitrage PoC schema
-- Run this in the Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  zone_id text not null,
  lat numeric,
  lon numeric,
  energy_mwh numeric not null,
  duration_hours numeric not null default 2,
  power_mw numeric not null,
  solar_mw numeric not null default 0,
  wind_mw numeric not null default 0,
  max_charge_mw numeric not null,
  max_discharge_mw numeric not null,
  min_soc_frac numeric not null default 0.1,
  max_soc_frac numeric not null default 0.9,
  initial_soc_frac numeric not null default 0.5,
  round_trip_efficiency numeric not null default 0.9,
  charge_efficiency numeric not null default 0.95,
  discharge_efficiency numeric not null default 0.95,
  poi_limit_mw numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  operating_date date not null,
  time_resolution_minutes integer not null default 60,
  forecast_version integer not null default 1,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scenario_timeseries (
  scenario_id uuid not null references public.scenarios(id) on delete cascade,
  forecast_version integer not null,
  timestamp timestamptz not null,
  zonal_price_usd_per_mwh numeric,
  solar_forecast_mw numeric,
  wind_forecast_mw numeric,
  created_at timestamptz not null default now(),
  primary key (scenario_id, forecast_version, timestamp)
);

create table if not exists public.optimization_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.scenarios(id) on delete cascade,
  forecast_version integer not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending',
  objective_value_usd numeric
);

create table if not exists public.optimization_results (
  run_id uuid not null references public.optimization_runs(id) on delete cascade,
  timestamp timestamptz not null,
  charge_mw numeric not null default 0,
  discharge_mw numeric not null default 0,
  soc_mwh numeric not null,
  net_grid_mw numeric not null,
  created_at timestamptz not null default now(),
  primary key (run_id, timestamp)
);

create index if not exists scenarios_asset_id_idx on public.scenarios(asset_id);
create index if not exists scenario_timeseries_scenario_id_idx on public.scenario_timeseries(scenario_id);
create index if not exists optimization_runs_scenario_id_idx on public.optimization_runs(scenario_id);
create index if not exists optimization_results_run_id_idx on public.optimization_results(run_id);
