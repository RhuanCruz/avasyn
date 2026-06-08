create table if not exists public.avatars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'draft')),
  persona_summary text,
  about text,
  primary_platform text not null default 'instagram',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists avatars_user_created_idx
  on public.avatars (user_id, created_at desc);

alter table public.avatars enable row level security;

create policy "avatars_select_own"
  on public.avatars for select
  using ((select auth.uid()) = user_id);

create policy "avatars_insert_own"
  on public.avatars for insert
  with check ((select auth.uid()) = user_id);

create policy "avatars_update_own"
  on public.avatars for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "avatars_delete_own"
  on public.avatars for delete
  using ((select auth.uid()) = user_id);

create or replace function public.touch_avatar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists avatars_touch_updated_at on public.avatars;
create trigger avatars_touch_updated_at
before update on public.avatars
for each row execute procedure public.touch_avatar_updated_at();

insert into public.avatars (user_id, name, slug, status, persona_summary, primary_platform)
select
  users.id,
  'Avatar principal',
  'avatar-principal',
  'active',
  'Operação principal',
  'instagram'
from auth.users as users
where not exists (
  select 1
  from public.avatars
  where avatars.user_id = users.id
);

alter table public.social_accounts
  add column if not exists avatar_id uuid references public.avatars(id) on delete cascade;

alter table public.source_videos
  add column if not exists avatar_id uuid references public.avatars(id) on delete cascade;

alter table public.reaction_videos
  add column if not exists avatar_id uuid references public.avatars(id) on delete cascade;

alter table public.automations
  add column if not exists avatar_id uuid references public.avatars(id) on delete cascade;

alter table public.reel_jobs
  add column if not exists avatar_id uuid references public.avatars(id) on delete cascade;

alter table public.post_history
  add column if not exists avatar_id uuid references public.avatars(id) on delete cascade;

alter table public.media_imports
  add column if not exists avatar_id uuid references public.avatars(id) on delete cascade;

update public.social_accounts as target
set avatar_id = source.id
from public.avatars as source
where source.user_id = target.user_id
  and target.avatar_id is null;

update public.source_videos as target
set avatar_id = source.id
from public.avatars as source
where source.user_id = target.user_id
  and target.avatar_id is null;

update public.reaction_videos as target
set avatar_id = source.id
from public.avatars as source
where source.user_id = target.user_id
  and target.avatar_id is null;

update public.automations as target
set avatar_id = source.id
from public.avatars as source
where source.user_id = target.user_id
  and target.avatar_id is null;

update public.reel_jobs as target
set avatar_id = source.id
from public.avatars as source
where source.user_id = target.user_id
  and target.avatar_id is null;

update public.post_history as target
set avatar_id = source.id
from public.avatars as source
where source.user_id = target.user_id
  and target.avatar_id is null;

update public.media_imports as target
set avatar_id = source.id
from public.avatars as source
where source.user_id = target.user_id
  and target.avatar_id is null;

alter table public.social_accounts
  alter column avatar_id set not null;

alter table public.source_videos
  alter column avatar_id set not null;

alter table public.reaction_videos
  alter column avatar_id set not null;

alter table public.automations
  alter column avatar_id set not null;

alter table public.reel_jobs
  alter column avatar_id set not null;

alter table public.post_history
  alter column avatar_id set not null;

alter table public.media_imports
  alter column avatar_id set not null;

create index if not exists social_accounts_user_avatar_idx
  on public.social_accounts (user_id, avatar_id, created_at desc);

create index if not exists source_videos_user_avatar_idx
  on public.source_videos (user_id, avatar_id, created_at desc);

create index if not exists reaction_videos_user_avatar_idx
  on public.reaction_videos (user_id, avatar_id, created_at desc);

create index if not exists automations_user_avatar_idx
  on public.automations (user_id, avatar_id, created_at desc);

create index if not exists reel_jobs_user_avatar_idx
  on public.reel_jobs (user_id, avatar_id, created_at desc);

create index if not exists post_history_user_avatar_idx
  on public.post_history (user_id, avatar_id, created_at desc);

create index if not exists media_imports_user_avatar_idx
  on public.media_imports (user_id, avatar_id, created_at desc);

drop policy if exists "reaction_videos_insert_own" on public.reaction_videos;
create policy "reaction_videos_insert_own"
  on public.reaction_videos for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.avatars
      where avatars.id = reaction_videos.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );

drop policy if exists "source_videos_insert_own" on public.source_videos;
create policy "source_videos_insert_own"
  on public.source_videos for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.avatars
      where avatars.id = source_videos.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );

drop policy if exists "media_imports_insert_own" on public.media_imports;
create policy "media_imports_insert_own"
  on public.media_imports for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.avatars
      where avatars.id = media_imports.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );

drop policy if exists "automations_insert_own" on public.automations;
create policy "automations_insert_own"
  on public.automations for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.avatars
      where avatars.id = automations.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );

drop policy if exists "automations_update_own" on public.automations;
create policy "automations_update_own"
  on public.automations for update
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.avatars
      where avatars.id = automations.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.avatars;
exception
  when duplicate_object then null;
end $$;
