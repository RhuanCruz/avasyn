-- Add YouTube support alongside Instagram.
-- 1. Relax the platform CHECK so social_accounts can hold youtube accounts.
-- 2. Create reel_job_targets for fan-out (one job → multiple networks).
-- 3. Extend post_history unique key to (job_id, account_id) for per-network rows.
-- 4. Backfill existing jobs that already have an account.

-- 1. Platform constraint
alter table public.social_accounts
  drop constraint if exists social_accounts_platform_check;

alter table public.social_accounts
  add constraint social_accounts_platform_check
  check (platform in ('instagram', 'youtube'));

-- Remove hardcoded default so callers must be explicit
alter table public.social_accounts
  alter column platform drop default;

-- 2. Per-network target table (fan-out from one reel_job to 1+ accounts/platforms)
create table if not exists public.reel_job_targets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.reel_jobs(id) on delete cascade,
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'youtube')),
  zernio_post_id text,
  platform_post_url text,
  status public.post_status not null default 'scheduled',
  error_message text,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, account_id)
);

create index if not exists reel_job_targets_job_id_idx
  on public.reel_job_targets(job_id);

create index if not exists reel_job_targets_zernio_post_id_idx
  on public.reel_job_targets(zernio_post_id)
  where zernio_post_id is not null;

alter table public.reel_job_targets enable row level security;

create policy "reel_job_targets_select_own"
  on public.reel_job_targets for select
  using (
    exists (
      select 1 from public.reel_jobs j
      where j.id = job_id
        and j.user_id = (select auth.uid())
    )
  );

-- 3. post_history: allow one row per (job, account) instead of one per job
drop index if exists post_history_job_unique_idx;

create unique index if not exists post_history_job_account_unique_idx
  on public.post_history (job_id, account_id);

-- 4. Backfill targets for existing jobs that have an account_id
insert into public.reel_job_targets
  (job_id, account_id, platform, zernio_post_id, platform_post_url, status, posted_at)
select
  j.id,
  j.account_id,
  sa.platform,
  j.zernio_post_id,
  j.platform_post_url,
  case
    when j.status = 'posted'  then 'published'::public.post_status
    when j.status = 'error'   then 'failed'::public.post_status
    else 'scheduled'::public.post_status
  end,
  j.posted_at
from public.reel_jobs j
join public.social_accounts sa on sa.id = j.account_id
on conflict (job_id, account_id) do nothing;
