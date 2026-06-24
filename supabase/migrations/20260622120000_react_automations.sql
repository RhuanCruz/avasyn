-- React automations per avatar.
-- Expands the legacy `automations` table into a recurring recipe (search → dedup →
-- render → schedule) and adds run/usage/candidate tracking tables.

-- 1a. Expand automations (keep legacy columns for backward compatibility) -------

alter table public.automations
  add column if not exists name text not null default 'Automação react()',
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'error')),
  add column if not exists source_platforms text[] not null default array['youtube'],
  add column if not exists search_queries text[] not null default '{}',
  add column if not exists days_of_week int[] not null default '{}',
  add column if not exists timezone text not null default 'America/Sao_Paulo',
  add column if not exists caption_mode text not null default 'ideas'
    check (caption_mode in ('fixed', 'ideas', 'ai')),
  add column if not exists caption_ideas text[] not null default '{}',
  add column if not exists overlay_mode text not null default 'ideas'
    check (overlay_mode in ('fixed', 'ideas', 'ai')),
  add column if not exists overlay_ideas text[] not null default '{}',
  add column if not exists approval_mode text not null default 'auto'
    check (approval_mode in ('auto', 'review')),
  add column if not exists min_view_count bigint not null default 0,
  add column if not exists max_duration_s int not null default 90,
  add column if not exists recent_days int not null default 14,
  add column if not exists last_run_at timestamptz,
  add column if not exists last_error_message text,
  add column if not exists updated_at timestamptz not null default now();

-- Relax legacy NOT NULL constraints so a draft can be saved without an account
-- and without the old clip-list model. New columns above drive the new flow.
alter table public.automations alter column account_id drop not null;
alter table public.automations alter column posts_per_day set default 1;
alter table public.automations alter column post_times set default '{}';
alter table public.automations alter column reaction_pool set default '{}';
alter table public.automations alter column clip_urls set default '{}';
alter table public.automations alter column caption_template set default '';
alter table public.automations alter column overlay_text set default '';

create index if not exists automations_status_idx
  on public.automations (status, active);

-- 1b. New tables ---------------------------------------------------------------

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  scheduled_slot_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'searching', 'reserved', 'job_created', 'no_candidate', 'error')),
  query text,
  source_platform text,
  candidate_url text,
  content_usage_id uuid,
  reel_job_id uuid references public.reel_jobs(id) on delete set null,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists automation_runs_slot_unique
  on public.automation_runs (automation_id, scheduled_slot_at);
create index if not exists automation_runs_automation_idx
  on public.automation_runs (automation_id, started_at desc);
create index if not exists automation_runs_user_idx
  on public.automation_runs (user_id, started_at desc);

create table if not exists public.content_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  automation_id uuid references public.automations(id) on delete set null,
  source_platform text not null,
  source_external_id text,
  canonical_url text not null,
  source_url text not null,
  source_video_id uuid references public.source_videos(id) on delete set null,
  reel_job_id uuid references public.reel_jobs(id) on delete set null,
  status text not null default 'reserved'
    check (status in ('reserved', 'job_created', 'rendered', 'posted', 'failed')),
  used_at timestamptz not null default now(),
  error_message text
);

create unique index if not exists content_usage_external_unique
  on public.content_usage (avatar_id, source_platform, source_external_id)
  where source_external_id is not null;
create unique index if not exists content_usage_canonical_unique
  on public.content_usage (avatar_id, canonical_url);
create index if not exists content_usage_automation_idx
  on public.content_usage (automation_id, used_at desc);

create table if not exists public.automation_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  run_id uuid references public.automation_runs(id) on delete cascade,
  source_platform text not null,
  source_external_id text,
  source_url text not null,
  canonical_url text not null,
  title text,
  thumbnail_url text,
  duration_s int,
  view_count bigint,
  published_at timestamptz,
  status text not null default 'found'
    check (status in ('found', 'skipped_used', 'skipped_filter', 'reserved', 'failed')),
  skip_reason text,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists automation_candidates_automation_idx
  on public.automation_candidates (automation_id, created_at desc);
create index if not exists automation_candidates_run_idx
  on public.automation_candidates (run_id);

-- 1c. RLS: users read their own rows; writes happen via service role (bypasses RLS)

alter table public.automation_runs enable row level security;
alter table public.content_usage enable row level security;
alter table public.automation_candidates enable row level security;

create policy "automation_runs_select_own"
  on public.automation_runs for select
  using ((select auth.uid()) = user_id);

create policy "content_usage_select_own"
  on public.content_usage for select
  using ((select auth.uid()) = user_id);

create policy "automation_candidates_select_own"
  on public.automation_candidates for select
  using ((select auth.uid()) = user_id);

-- 1d. Realtime -----------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.automation_runs;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.automations;
exception when duplicate_object then null;
end $$;

-- 1e. Cron: replace the legacy hourly scheduler with a 5-minute runner ---------
-- NOTE: this project's `postgres` role cannot ALTER DATABASE SET custom GUCs, so
-- `current_setting('app.settings.*')` is unavailable. We hardcode the public
-- functions URL and use the **public anon key** as the verify_jwt bearer (the
-- function uses its own SUPABASE_SERVICE_ROLE_KEY env for DB writes; the bearer
-- is only the JWT gate). The anon key is public (shipped in the frontend), so
-- it is safe to commit. Update both values if the project changes.

do $$
begin
  perform cron.unschedule('avasyn-automation-scheduler');
exception when others then null;
end $$;

select cron.schedule(
  'avasyn-automation-runner',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://noswvobckrcctffbbuve.supabase.co/functions/v1/automation-runner',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vc3d2b2Jja3JjY3RmZmJidXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NDQ0ODEsImV4cCI6MjA5NzUyMDQ4MX0.HkUWIjJ2nfRl_5CCCIUlxV9YmHQE1Lkg6njFydjI-3o',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
)
where not exists (
  select 1 from cron.job where jobname = 'avasyn-automation-runner'
);
