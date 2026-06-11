create table if not exists public.content_search_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  query text not null,
  platform text not null check (platform in ('youtube', 'tiktok', 'instagram')),
  result_url text not null,
  external_id text,
  title text,
  thumbnail_url text,
  duration_s int,
  view_count bigint,
  like_count bigint,
  author_username text,
  published_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  searched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  unique (user_id, avatar_id, query, platform, result_url)
);

create index if not exists content_search_results_user_avatar_query_idx
  on public.content_search_results (user_id, avatar_id, query, platform, searched_at desc);

create index if not exists content_search_results_expires_idx
  on public.content_search_results (expires_at);

create index if not exists content_search_results_external_id_idx
  on public.content_search_results (user_id, platform, external_id)
  where external_id is not null;

alter table public.content_search_results enable row level security;

create policy "content_search_results_select_own"
  on public.content_search_results for select
  using ((select auth.uid()) = user_id);
