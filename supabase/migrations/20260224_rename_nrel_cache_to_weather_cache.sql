-- Rename provider-agnostic weather cache table from legacy `nrel_cache` to `weather_cache`.

do $$
begin
  if to_regclass('public.weather_cache') is null and to_regclass('public.nrel_cache') is not null then
    execute 'alter table public.nrel_cache rename to weather_cache';
  end if;
end
$$;

alter index if exists public.nrel_cache_project_dataset_idx
  rename to weather_cache_project_dataset_idx;

alter index if exists public.nrel_cache_payload_gin_idx
  rename to weather_cache_payload_gin_idx;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'nrel_cache_weather_cache_key'
      and conrelid = 'public.weather_cache'::regclass
  ) then
    execute 'alter table public.weather_cache rename constraint nrel_cache_weather_cache_key to weather_cache_cache_key';
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'nrel_cache_dataset_check'
      and conrelid = 'public.weather_cache'::regclass
  ) then
    execute 'alter table public.weather_cache rename constraint nrel_cache_dataset_check to weather_cache_dataset_check';
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'nrel_cache_provider_check'
      and conrelid = 'public.weather_cache'::regclass
  ) then
    execute 'alter table public.weather_cache rename constraint nrel_cache_provider_check to weather_cache_provider_check';
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'nrel_cache_source_year_open_meteo_check'
      and conrelid = 'public.weather_cache'::regclass
  ) then
    execute 'alter table public.weather_cache rename constraint nrel_cache_source_year_open_meteo_check to weather_cache_source_year_open_meteo_check';
  end if;
end
$$;

alter table public.weather_cache enable row level security;
alter table public.weather_cache alter column source set default 'weather_proxy';

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'weather_cache' and policyname = 'nrel_cache_anon_all'
  ) then
    execute 'drop policy nrel_cache_anon_all on public.weather_cache';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'weather_cache' and policyname = 'weather_cache_anon_all'
  ) then
    create policy weather_cache_anon_all on public.weather_cache
      for all
      to anon
      using (true)
      with check (true);
  end if;
end
$$;

create index if not exists weather_cache_project_dataset_idx
  on public.weather_cache (project_id, provider, dataset, fetched_at desc);

create index if not exists weather_cache_payload_gin_idx
  on public.weather_cache using gin (payload);
