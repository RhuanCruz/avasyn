-- Trends per avatar: the user registers themes to watch and the Trends tab shows
-- videos that are trending (or rising) on the chosen networks via ScrapeCreators.

-- Watched themes (user-managed directly, like `automations`) ------------------

create table if not exists public.trend_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  theme text not null,
  platforms text[] not null default array['youtube', 'tiktok', 'instagram'],
  active boolean not null default true,
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists trend_watches_theme_unique
  on public.trend_watches (avatar_id, lower(theme));
create index if not exists trend_watches_avatar_idx
  on public.trend_watches (avatar_id, created_at desc);

-- Cached trending/search results per watch (written by service role) ----------

create table if not exists public.trend_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  trend_watch_id uuid not null references public.trend_watches(id) on delete cascade,
  platform text not null,
  external_id text,
  canonical_url text not null,
  source_url text not null,
  title text,
  thumbnail_url text,
  duration_s int,
  view_count bigint,
  like_count bigint,
  author_username text,
  published_at timestamptz,
  is_trending boolean not null default false,
  trend_score numeric not null default 0,
  raw jsonb not null default '{}',
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 hours')
);

create unique index if not exists trend_videos_unique
  on public.trend_videos (trend_watch_id, platform, canonical_url);
create index if not exists trend_videos_watch_idx
  on public.trend_videos (trend_watch_id, trend_score desc);
create index if not exists trend_videos_avatar_idx
  on public.trend_videos (avatar_id, fetched_at desc);

-- RLS -------------------------------------------------------------------------

alter table public.trend_watches enable row level security;
alter table public.trend_videos enable row level security;

create policy "trend_watches_select_own"
  on public.trend_watches for select
  using ((select auth.uid()) = user_id);
create policy "trend_watches_insert_own"
  on public.trend_watches for insert
  with check ((select auth.uid()) = user_id);
create policy "trend_watches_update_own"
  on public.trend_watches for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "trend_watches_delete_own"
  on public.trend_watches for delete
  using ((select auth.uid()) = user_id);

-- trend_videos is read-only for users; writes go through the service role.
create policy "trend_videos_select_own"
  on public.trend_videos for select
  using ((select auth.uid()) = user_id);
