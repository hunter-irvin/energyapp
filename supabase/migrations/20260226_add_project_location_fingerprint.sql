alter table public.projects
  add column if not exists location_fingerprint text;
