alter table public.avatars
  add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatar-photos',
  'avatar-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatar_photos_select_own" on storage.objects;
create policy "avatar_photos_select_own"
  on storage.objects for select
  using (
    bucket_id = 'avatar-photos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "avatar_photos_insert_own" on storage.objects;
create policy "avatar_photos_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'avatar-photos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "avatar_photos_delete_own" on storage.objects;
create policy "avatar_photos_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'avatar-photos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
