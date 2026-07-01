-- Talking Head editor: free-form action/camera prompt per scene (used in both
-- fala and imagem modes, combined with the camera_movement preset at render time),
-- and a project-level motion video model for imagem scenes (separate from the
-- lip-sync video_model_id used by fala scenes).

alter table public.presenter_video_scenes
  add column if not exists action_prompt text;

alter table public.presenter_video_projects
  add column if not exists motion_model_id text;
