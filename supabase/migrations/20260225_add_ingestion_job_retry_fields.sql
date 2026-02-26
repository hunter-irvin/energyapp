alter table public.ingestion_jobs
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists next_retry_at timestamptz;

create index if not exists ingestion_jobs_retry_idx
  on public.ingestion_jobs (status, next_retry_at, priority, created_at);

