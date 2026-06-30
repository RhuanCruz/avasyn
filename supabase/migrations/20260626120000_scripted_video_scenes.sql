-- Multi-scene "scripted video" support.
-- A presenter_video_project now owns an ordered list of scenes, each being either an
-- avatar speech ("fala") or an image-with-narration ("imagem"). The legacy single-shot
-- flow is modelled as format = 'falado' with a single fala scene.

alter table public.presenter_video_projects
  add column if not exists format text not null default 'roteirizado'
    check (format in ('falado', 'roteirizado')),
  add column if not exists total_duration_s integer not null default 0;

create table if not exists public.presenter_video_scenes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  project_id uuid not null references public.presenter_video_projects(id) on delete cascade,
  position integer not null default 0,
  kind text not null default 'fala'
    check (kind in ('fala', 'imagem')),
  content_status text not null default 'empty'
    check (content_status in ('empty', 'draft', 'generating', 'ready', 'error')),
  duration_s integer not null default 8,
  camera_movement text not null default 'none'
    check (camera_movement in ('none', 'zoomin', 'zoomout', 'left', 'right', 'up')),
  image_style text not null default 'realista'
    check (image_style in ('realista', 'cine', 'ilustra', '3d')),
  text text,
  prompt text,
  improved_prompt text,
  narration text,
  image_id uuid references public.presenter_avatar_images(id) on delete set null,
  hedra_image_asset_id text,
  hedra_generation_id text,
  clip_url text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists presenter_video_scenes_project_idx
  on public.presenter_video_scenes (project_id, position asc);
create index if not exists presenter_video_scenes_user_avatar_idx
  on public.presenter_video_scenes (user_id, avatar_id, created_at desc);

alter table public.presenter_video_scenes enable row level security;

create policy "presenter_video_scenes_select_own"
  on public.presenter_video_scenes for select
  using ((select auth.uid()) = user_id);
create policy "presenter_video_scenes_insert_own"
  on public.presenter_video_scenes for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.avatars
      where avatars.id = presenter_video_scenes.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );
create policy "presenter_video_scenes_update_own"
  on public.presenter_video_scenes for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "presenter_video_scenes_delete_own"
  on public.presenter_video_scenes for delete
  using ((select auth.uid()) = user_id);

do $$
begin
  alter publication supabase_realtime add table public.presenter_video_scenes;
exception
  when duplicate_object then null;
end $$;
