-- Per-scene video clip rendering: each scene renders its own Hedra clip
-- (fala = talking-head, imagem = image+narration). Final concatenation is a later phase.

alter table public.presenter_video_scenes
  add column if not exists clip_status text not null default 'idle'
    check (clip_status in ('idle', 'queued', 'rendering', 'ready', 'error')),
  add column if not exists clip_generation_id text,
  add column if not exists clip_thumbnail_url text,
  add column if not exists image_source text
    check (image_source in ('upload', 'library', 'generated'));
