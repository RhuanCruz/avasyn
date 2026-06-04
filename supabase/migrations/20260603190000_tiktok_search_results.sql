create table if not exists public.tiktok_search_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  result_url text not null,
  title text,
  thumbnail_url text,
  duration_s int,
  view_count bigint,
  uploader text,
  raw jsonb not null default '{}'::jsonb,
  searched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  unique (user_id, query, result_url)
);

create index if not exists tiktok_search_results_user_query_idx
  on public.tiktok_search_results (user_id, query, searched_at desc);

create index if not exists tiktok_search_results_expires_idx
  on public.tiktok_search_results (expires_at);

alter table public.tiktok_search_results enable row level security;

create policy "tiktok_search_results_select_own"
  on public.tiktok_search_results for select
  using ((select auth.uid()) = user_id);
