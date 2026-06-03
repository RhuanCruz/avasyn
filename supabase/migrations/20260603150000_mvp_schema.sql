create extension if not exists pgcrypto with schema extensions;
create schema if not exists pgmq;
create extension if not exists pgmq with schema pgmq;
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
begin
  create type public.job_status as enum (
    'pending', 'processing', 'rendered', 'posting', 'posted', 'error'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.post_status as enum (
    'scheduled', 'published', 'failed', 'partial', 'cancelled'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.reaction_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  storage_path text not null,
  duration_s int,
  created_at timestamptz not null default now()
);

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  zernio_profile_id text not null,
  zernio_account_id text not null,
  platform text not null default 'instagram' check (platform = 'instagram'),
  username text,
  display_name text not null,
  profile_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, zernio_account_id)
);

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  posts_per_day int not null check (posts_per_day between 1 and 20),
  post_times text[] not null,
  reaction_pool uuid[] not null,
  clip_urls text[] not null,
  caption_template text not null,
  overlay_text text not null,
  share_to_feed boolean not null default true,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.reel_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  automation_id uuid references public.automations(id) on delete set null,
  account_id uuid references public.social_accounts(id) on delete set null,
  clip_url text not null,
  reaction_id uuid not null references public.reaction_videos(id),
  overlay_text text not null,
  caption text not null,
  status public.job_status not null default 'pending',
  error_message text,
  output_path text,
  zernio_media_url text,
  zernio_post_id text,
  platform_post_url text,
  scheduled_post_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.post_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.reel_jobs(id) on delete cascade,
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  zernio_post_id text,
  platform_post_url text,
  status public.post_status not null,
  error_message text,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists post_history_job_unique_idx
  on public.post_history (job_id);

create table if not exists public.zernio_webhook_events (
  id text primary key,
  event text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists reaction_videos_user_created_idx
  on public.reaction_videos (user_id, created_at desc);
create index if not exists social_accounts_user_active_idx
  on public.social_accounts (user_id, active);
create index if not exists automations_active_times_idx
  on public.automations (active, user_id);
create index if not exists reel_jobs_user_created_idx
  on public.reel_jobs (user_id, created_at desc);
create index if not exists reel_jobs_status_idx
  on public.reel_jobs (status, created_at);
create index if not exists post_history_user_created_idx
  on public.post_history (user_id, created_at desc);
create index if not exists post_history_job_idx
  on public.post_history (job_id);

alter table public.reaction_videos enable row level security;
alter table public.social_accounts enable row level security;
alter table public.automations enable row level security;
alter table public.reel_jobs enable row level security;
alter table public.post_history enable row level security;
alter table public.zernio_webhook_events enable row level security;

create policy "reaction_videos_select_own"
  on public.reaction_videos for select
  using ((select auth.uid()) = user_id);
create policy "reaction_videos_insert_own"
  on public.reaction_videos for insert
  with check ((select auth.uid()) = user_id);
create policy "reaction_videos_delete_own"
  on public.reaction_videos for delete
  using ((select auth.uid()) = user_id);

create policy "social_accounts_select_own"
  on public.social_accounts for select
  using ((select auth.uid()) = user_id);
create policy "social_accounts_update_own"
  on public.social_accounts for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "automations_select_own"
  on public.automations for select
  using ((select auth.uid()) = user_id);
create policy "automations_insert_own"
  on public.automations for insert
  with check ((select auth.uid()) = user_id);
create policy "automations_update_own"
  on public.automations for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "automations_delete_own"
  on public.automations for delete
  using ((select auth.uid()) = user_id);

create policy "reel_jobs_select_own"
  on public.reel_jobs for select
  using ((select auth.uid()) = user_id);

create policy "post_history_select_own"
  on public.post_history for select
  using ((select auth.uid()) = user_id);

create policy "zernio_webhook_events_service_only"
  on public.zernio_webhook_events for all
  using (false)
  with check (false);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reaction-videos',
  'reaction-videos',
  false,
  314572800,
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'generated-reels',
  'generated-reels',
  false,
  314572800,
  array['video/mp4', 'video/quicktime']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "reaction_storage_select_own"
  on storage.objects for select
  using (
    bucket_id = 'reaction-videos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "reaction_storage_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'reaction-videos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "reaction_storage_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'reaction-videos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "generated_reels_select_own"
  on storage.objects for select
  using (
    bucket_id = 'generated-reels'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

do $$
begin
  perform pgmq.create('reel_jobs');
exception
  when duplicate_table then null;
  when unique_violation then null;
end $$;

create or replace function public.enqueue_reel_job(job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  job public.reel_jobs;
begin
  select * into job
  from public.reel_jobs
  where id = job_id;

  if not found then
    raise exception 'Job % not found', job_id;
  end if;

  perform pgmq.send(
    'reel_jobs',
    jsonb_build_object(
      'job_id', job.id,
      'user_id', job.user_id,
      'clip_url', job.clip_url,
      'reaction_id', job.reaction_id,
      'account_id', job.account_id
    )
  );
end;
$$;

revoke all on function public.enqueue_reel_job(uuid) from public;
grant execute on function public.enqueue_reel_job(uuid) to service_role;

create or replace function public.read_reel_job_messages(qty int default 1)
returns table(msg_id bigint, read_ct int, enqueued_at timestamptz, vt timestamptz, message jsonb)
language sql
security definer
set search_path = public, pgmq
as $$
  select msg_id, read_ct, enqueued_at, vt, message
  from pgmq.read('reel_jobs', 60, qty);
$$;

revoke all on function public.read_reel_job_messages(int) from public;
grant execute on function public.read_reel_job_messages(int) to service_role;

create or replace function public.delete_reel_job_message(msg_id bigint)
returns boolean
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.delete('reel_jobs', msg_id);
$$;

revoke all on function public.delete_reel_job_message(bigint) from public;
grant execute on function public.delete_reel_job_message(bigint) to service_role;

alter publication supabase_realtime add table public.reel_jobs;

select cron.schedule(
  'avasyn-automation-scheduler',
  '0 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/automation-scheduler',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
)
where not exists (
  select 1 from cron.job where jobname = 'avasyn-automation-scheduler'
);
