create table if not exists public.load_profiles (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  name text not null,
  model jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists load_profiles_project_updated_idx
  on public.load_profiles (project_id, updated_at desc);

alter table public.load_profiles enable row level security;

drop policy if exists load_profiles_anon_all on public.load_profiles;
create policy load_profiles_anon_all on public.load_profiles
  for all
  to anon
  using (true)
  with check (true);
