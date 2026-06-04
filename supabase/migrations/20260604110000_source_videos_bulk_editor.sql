create table if not exists public.source_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  storage_path text not null,
  duration_s int,
  created_at timestamptz not null default now()
);

alter table public.reel_jobs
  add column if not exists source_video_id uuid
    references public.source_videos(id) on delete set null;

create index if not exists source_videos_user_created_idx
  on public.source_videos (user_id, created_at desc);

create index if not exists reel_jobs_source_video_idx
  on public.reel_jobs (source_video_id);

alter table public.source_videos enable row level security;

create policy "source_videos_select_own"
  on public.source_videos for select
  using ((select auth.uid()) = user_id);

create policy "source_videos_insert_own"
  on public.source_videos for insert
  with check ((select auth.uid()) = user_id);

create policy "source_videos_delete_own"
  on public.source_videos for delete
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'source-videos',
  'source-videos',
  false,
  314572800,
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "source_storage_select_own"
  on storage.objects for select
  using (
    bucket_id = 'source-videos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "source_storage_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'source-videos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "source_storage_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'source-videos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
