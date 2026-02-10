-- Enable no-auth (anon) CRUD with RLS while still enforcing row-shape constraints.

-- Core tables for facility/projects and asset rows.
create table if not exists public.projects (
  id text primary key,
  name text not null default 'Untitled Facility',
  location_lat double precision,
  location_lng double precision,
  selected_date text,
  map_state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id text primary key,
  project_id text not null,
  asset_type text not null,
  name text not null default '',
  model jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enforce required FK + cascade semantics for cleanup when a project is deleted.
alter table public.assets
  alter column project_id set not null;

alter table public.nrel_cache
  alter column project_id set not null;

alter table public.assets
  drop constraint if exists assets_project_id_fkey,
  add constraint assets_project_id_fkey
    foreign key (project_id)
    references public.projects(id)
    on delete cascade;

alter table public.nrel_cache
  drop constraint if exists nrel_cache_project_id_fkey,
  add constraint nrel_cache_project_id_fkey
    foreign key (project_id)
    references public.projects(id)
    on delete cascade;

-- Defensive constraints for malformed rows.
alter table public.assets
  drop constraint if exists assets_asset_type_check,
  add constraint assets_asset_type_check
    check (asset_type in ('solar', 'wind'));

alter table public.nrel_cache
  drop constraint if exists nrel_cache_dataset_check,
  add constraint nrel_cache_dataset_check
    check (dataset in ('solar', 'wind'));

-- Turn on RLS and allow anon access intentionally for no-user mode.
alter table public.projects enable row level security;
alter table public.assets enable row level security;
alter table public.nrel_cache enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_anon_all'
  ) then
    create policy projects_anon_all on public.projects
      for all
      to anon
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'assets' and policyname = 'assets_anon_all'
  ) then
    create policy assets_anon_all on public.assets
      for all
      to anon
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'nrel_cache' and policyname = 'nrel_cache_anon_all'
  ) then
    create policy nrel_cache_anon_all on public.nrel_cache
      for all
      to anon
      using (true)
      with check (true);
  end if;
end
$$;
