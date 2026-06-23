-- Auto-retry for reel jobs that fail on transient worker/download errors
-- (e.g. yt-dlp "Sign in to confirm you're not a bot" / expired YouTube cookies).

alter table public.reel_jobs
  add column if not exists retry_count int not null default 0,
  add column if not exists last_retried_at timestamptz;

-- Cron: scan for retryable failures every 15 minutes (backoff handled in-function).
select cron.schedule(
  'avasyn-retry-failed-jobs',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/retry-failed-jobs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
)
where not exists (
  select 1 from cron.job where jobname = 'avasyn-retry-failed-jobs'
);
