alter table public.presenter_avatar_profiles
  add column if not exists visual_provider text not null default 'hedra'
    check (visual_provider in ('hedra', 'upload', 'legacy_heygen')),
  add column if not exists video_provider text not null default 'hedra'
    check (video_provider in ('hedra', 'legacy_heygen')),
  add column if not exists voice_provider text not null default 'hedra'
    check (voice_provider in ('hedra', 'legacy_heygen')),
  add column if not exists visual_status text not null default 'not_started'
    check (visual_status in ('not_started', 'in_review', 'approved', 'error')),
  add column if not exists voice_status text not null default 'not_configured'
    check (voice_status in ('not_configured', 'public_selected', 'clone_processing', 'clone_ready', 'error')),
  add column if not exists approved_image_set_id uuid,
  add column if not exists approved_base_image_id uuid,
  add column if not exists hedra_voice_id text,
  add column if not exists hedra_image_model_id text,
  add column if not exists hedra_video_model_id text,
  add column if not exists hedra_image_asset_id text,
  add column if not exists hedra_voice_generation_id text,
  add column if not exists voice_metadata jsonb not null default '{}'::jsonb;

create table if not exists public.presenter_image_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  base_image_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'generating_options', 'options_generated', 'base_selected', 'generating_variations', 'ready_for_review', 'approved', 'error')),
  prompt_original text,
  prompt_improved text,
  image_model_id text,
  provider text not null default 'hedra'
    check (provider in ('hedra', 'upload')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.presenter_avatar_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  image_set_id uuid references public.presenter_image_sets(id) on delete set null,
  kind text not null
    check (kind in ('option', 'base', 'variation', 'upload')),
  source text not null
    check (source in ('hedra', 'upload')),
  status text not null default 'generated'
    check (status in ('draft', 'generated', 'selected', 'approved', 'rejected', 'error')),
  prompt text,
  improved_prompt text,
  variation_label text,
  storage_path text,
  preview_url text,
  provider text not null default 'hedra'
    check (provider in ('hedra', 'upload')),
  provider_asset_id text,
  provider_generation_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.presenter_image_sets
  drop constraint if exists presenter_image_sets_base_image_fk,
  add constraint presenter_image_sets_base_image_fk
    foreign key (base_image_id) references public.presenter_avatar_images(id) on delete set null;

alter table public.presenter_avatar_profiles
  drop constraint if exists presenter_profiles_approved_image_set_fk,
  add constraint presenter_profiles_approved_image_set_fk
    foreign key (approved_image_set_id) references public.presenter_image_sets(id) on delete set null,
  drop constraint if exists presenter_profiles_approved_base_image_fk,
  add constraint presenter_profiles_approved_base_image_fk
    foreign key (approved_base_image_id) references public.presenter_avatar_images(id) on delete set null;

alter table public.presenter_video_projects
  add column if not exists provider text not null default 'hedra'
    check (provider in ('hedra', 'legacy_heygen')),
  add column if not exists hedra_generation_id text,
  add column if not exists hedra_video_asset_id text,
  add column if not exists image_asset_id text,
  add column if not exists voice_id text,
  add column if not exists video_model_id text,
  add column if not exists render_metadata jsonb not null default '{}'::jsonb;

create index if not exists presenter_image_sets_user_avatar_idx
  on public.presenter_image_sets (user_id, avatar_id, created_at desc);
create index if not exists presenter_avatar_images_user_avatar_idx
  on public.presenter_avatar_images (user_id, avatar_id, created_at desc);
create index if not exists presenter_avatar_images_set_idx
  on public.presenter_avatar_images (image_set_id, created_at asc);
create index if not exists presenter_video_projects_hedra_generation_idx
  on public.presenter_video_projects (hedra_generation_id)
  where hedra_generation_id is not null;

alter table public.presenter_image_sets enable row level security;
alter table public.presenter_avatar_images enable row level security;

create policy "presenter_image_sets_select_own"
  on public.presenter_image_sets for select
  using ((select auth.uid()) = user_id);
create policy "presenter_image_sets_insert_own"
  on public.presenter_image_sets for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.avatars
      where avatars.id = presenter_image_sets.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );
create policy "presenter_image_sets_update_own"
  on public.presenter_image_sets for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "presenter_image_sets_delete_own"
  on public.presenter_image_sets for delete
  using ((select auth.uid()) = user_id);

create policy "presenter_avatar_images_select_own"
  on public.presenter_avatar_images for select
  using ((select auth.uid()) = user_id);
create policy "presenter_avatar_images_insert_own"
  on public.presenter_avatar_images for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.avatars
      where avatars.id = presenter_avatar_images.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );
create policy "presenter_avatar_images_update_own"
  on public.presenter_avatar_images for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "presenter_avatar_images_delete_own"
  on public.presenter_avatar_images for delete
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'presenter-avatar-images',
  'presenter-avatar-images',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "presenter_avatar_images_storage_select_own"
  on storage.objects for select
  using (
    bucket_id = 'presenter-avatar-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "presenter_avatar_images_storage_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'presenter-avatar-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "presenter_avatar_images_storage_update_own"
  on storage.objects for update
  using (
    bucket_id = 'presenter-avatar-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'presenter-avatar-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "presenter_avatar_images_storage_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'presenter-avatar-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

do $$
begin
  alter publication supabase_realtime add table public.presenter_image_sets;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.presenter_avatar_images;
exception
  when duplicate_object then null;
end $$;
