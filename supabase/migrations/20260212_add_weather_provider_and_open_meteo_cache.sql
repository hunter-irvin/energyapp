-- Add provider-flexible weather cache and project weather provider selection.
alter table public.projects
  add column if not exists weather_provider text;

alter table public.projects
  drop constraint if exists projects_weather_provider_check,
  add constraint projects_weather_provider_check
    check (weather_provider in ('nrel', 'open_meteo') or weather_provider is null);

alter table public.nrel_cache
  add column if not exists provider text;

update public.nrel_cache
set provider = 'nrel'
where provider is null;

alter table public.nrel_cache
  alter column provider set default 'nrel',
  alter column provider set not null;

alter table public.nrel_cache
  alter column source_year drop not null;

alter table public.nrel_cache
  drop constraint if exists nrel_cache_provider_check,
  add constraint nrel_cache_provider_check
    check (provider in ('nrel', 'open_meteo'));

alter table public.nrel_cache
  drop constraint if exists nrel_cache_source_year_open_meteo_check,
  add constraint nrel_cache_source_year_open_meteo_check
    check ((provider = 'open_meteo' and source_year is null) or provider = 'nrel');

drop index if exists nrel_cache_project_dataset_idx;
create index if not exists nrel_cache_project_dataset_idx
  on public.nrel_cache (project_id, provider, dataset, fetched_at desc);

alter table public.nrel_cache
  drop constraint if exists nrel_cache_project_id_dataset_date_key_source_year_interval_minutes_key;

alter table public.nrel_cache
  add constraint nrel_cache_weather_cache_key
    unique nulls not distinct (project_id, provider, dataset, date_key, interval_minutes, source_year);
