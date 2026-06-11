alter table public.avatars
  add column if not exists avatar_kind text not null default 'react'
    check (avatar_kind in ('react', 'presenter'));

create index if not exists avatars_user_kind_created_idx
  on public.avatars (user_id, avatar_kind, created_at desc);

create table if not exists public.presenter_personas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  raw_persona text not null,
  structured_persona jsonb not null default '{}'::jsonb,
  status text not null default 'generated'
    check (status in ('draft', 'generated', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (avatar_id)
);

create table if not exists public.presenter_avatar_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  main_topic text not null,
  visual_prompt text,
  visual_prompt_status text not null default 'draft'
    check (visual_prompt_status in ('draft', 'approved')),
  heygen_avatar_group_id text,
  heygen_avatar_id text,
  heygen_preview_image_url text,
  heygen_preview_video_url text,
  default_voice_id text,
  selected_voice_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (avatar_id)
);

create table if not exists public.presenter_voice_options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  voice_id text not null,
  name text not null,
  language text,
  gender text,
  preview_audio_url text,
  seed int,
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  unique (avatar_id, voice_id)
);

create table if not exists public.presenter_video_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  topic text not null,
  research_summary jsonb not null default '{}'::jsonb,
  script jsonb not null default '{}'::jsonb,
  script_text text,
  status text not null default 'draft'
    check (status in (
      'draft',
      'script_pending_review',
      'ready_for_video',
      'submitted',
      'processing',
      'completed',
      'error'
    )),
  heygen_video_id text,
  video_url text,
  thumbnail_url text,
  duration_s numeric,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists presenter_personas_user_avatar_idx
  on public.presenter_personas (user_id, avatar_id);
create index if not exists presenter_profiles_user_avatar_idx
  on public.presenter_avatar_profiles (user_id, avatar_id);
create index if not exists presenter_voice_options_user_avatar_idx
  on public.presenter_voice_options (user_id, avatar_id, created_at desc);
create index if not exists presenter_video_projects_user_avatar_idx
  on public.presenter_video_projects (user_id, avatar_id, created_at desc);
create index if not exists presenter_video_projects_heygen_video_idx
  on public.presenter_video_projects (heygen_video_id)
  where heygen_video_id is not null;

alter table public.presenter_personas enable row level security;
alter table public.presenter_avatar_profiles enable row level security;
alter table public.presenter_voice_options enable row level security;
alter table public.presenter_video_projects enable row level security;

create policy "presenter_personas_select_own"
  on public.presenter_personas for select
  using ((select auth.uid()) = user_id);
create policy "presenter_personas_insert_own"
  on public.presenter_personas for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.avatars
      where avatars.id = presenter_personas.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );
create policy "presenter_personas_update_own"
  on public.presenter_personas for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "presenter_profiles_select_own"
  on public.presenter_avatar_profiles for select
  using ((select auth.uid()) = user_id);
create policy "presenter_profiles_insert_own"
  on public.presenter_avatar_profiles for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.avatars
      where avatars.id = presenter_avatar_profiles.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );
create policy "presenter_profiles_update_own"
  on public.presenter_avatar_profiles for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "presenter_voice_options_select_own"
  on public.presenter_voice_options for select
  using ((select auth.uid()) = user_id);
create policy "presenter_voice_options_insert_own"
  on public.presenter_voice_options for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.avatars
      where avatars.id = presenter_voice_options.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );
create policy "presenter_voice_options_update_own"
  on public.presenter_voice_options for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "presenter_video_projects_select_own"
  on public.presenter_video_projects for select
  using ((select auth.uid()) = user_id);
create policy "presenter_video_projects_insert_own"
  on public.presenter_video_projects for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.avatars
      where avatars.id = presenter_video_projects.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );
create policy "presenter_video_projects_update_own"
  on public.presenter_video_projects for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "presenter_video_projects_delete_own"
  on public.presenter_video_projects for delete
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatar-reference-images',
  'avatar-reference-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "avatar_reference_images_select_own"
  on storage.objects for select
  using (
    bucket_id = 'avatar-reference-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "avatar_reference_images_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'avatar-reference-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "avatar_reference_images_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'avatar-reference-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

do $$
begin
  alter publication supabase_realtime add table public.presenter_video_projects;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.presenter_personas;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.presenter_avatar_profiles;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.presenter_voice_options;
exception
  when duplicate_object then null;
end $$;
