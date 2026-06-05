alter table public.source_videos
  add column if not exists source_type text not null default 'upload'
    check (source_type in ('upload', 'url', 'instagram_profile')),
  add column if not exists source_url text,
  add column if not exists source_platform text,
  add column if not exists source_external_id text,
  add column if not exists source_username text,
  add column if not exists thumbnail_path text,
  add column if not exists source_published_at timestamptz,
  add column if not exists view_count bigint,
  add column if not exists like_count bigint,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists source_videos_external_id_unique
  on public.source_videos (user_id, source_platform, source_external_id)
  where source_external_id is not null;

create table if not exists public.media_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('url', 'instagram_profile')),
  input text not null,
  requested_limit int not null default 1 check (requested_limit between 1 and 50),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'partial', 'error')),
  total_items int not null default 0,
  processed_items int not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists media_imports_user_created_idx
  on public.media_imports (user_id, created_at desc);

alter table public.media_imports enable row level security;

create policy "media_imports_select_own"
  on public.media_imports for select
  using ((select auth.uid()) = user_id);

create policy "media_imports_insert_own"
  on public.media_imports for insert
  with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'source-thumbnails',
  'source-thumbnails',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "source_thumbnail_select_own"
  on storage.objects for select
  using (
    bucket_id = 'source-thumbnails'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "source_thumbnail_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'source-thumbnails'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "source_thumbnail_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'source-thumbnails'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

do $$
begin
  alter publication supabase_realtime add table public.media_imports;
exception
  when duplicate_object then null;
end $$;
