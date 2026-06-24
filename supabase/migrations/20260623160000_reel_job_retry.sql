-- Auto-retry for reel jobs that fail on transient worker/download errors
-- (e.g. yt-dlp "Sign in to confirm you're not a bot" / expired YouTube cookies).

alter table public.reel_jobs
  add column if not exists retry_count int not null default 0,
  add column if not exists last_retried_at timestamptz;

-- Cron: scan for retryable failures every 15 minutes (backoff handled in-function).
-- See react_automations migration: this project can't set app.settings.* GUCs, so
-- the URL is hardcoded and the public anon key is used as the verify_jwt bearer.
select cron.schedule(
  'avasyn-retry-failed-jobs',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://noswvobckrcctffbbuve.supabase.co/functions/v1/retry-failed-jobs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vc3d2b2Jja3JjY3RmZmJidXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NDQ0ODEsImV4cCI6MjA5NzUyMDQ4MX0.HkUWIjJ2nfRl_5CCCIUlxV9YmHQE1Lkg6njFydjI-3o',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
)
where not exists (
  select 1 from cron.job where jobname = 'avasyn-retry-failed-jobs'
);
