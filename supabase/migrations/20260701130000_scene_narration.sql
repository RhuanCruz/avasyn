-- Narração mode: per-scene narration voice (voice-over over a motion clip; the
-- character is not necessarily speaking) and an "assembling" clip status for the
-- worker ffmpeg mux step (motion video + narration audio).

alter table public.presenter_video_scenes
  add column if not exists narration_voice_id text;

alter table public.presenter_video_scenes
  drop constraint if exists presenter_video_scenes_clip_status_check;

alter table public.presenter_video_scenes
  add constraint presenter_video_scenes_clip_status_check
  check (clip_status in ('idle', 'queued', 'rendering', 'assembling', 'ready', 'error'));
