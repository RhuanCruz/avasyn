export type JobStatus =
  | "pending"
  | "processing"
  | "rendered"
  | "posting"
  | "posted"
  | "error";

export type PostStatus =
  | "scheduled"
  | "published"
  | "failed"
  | "partial"
  | "cancelled";

export type AvatarStatus = "active" | "paused" | "draft";
export type AvatarKind = "react" | "presenter";

export type Avatar = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  status: AvatarStatus;
  avatar_kind: AvatarKind;
  persona_summary: string | null;
  about: string | null;
  photo_path: string | null;
  primary_platform: string;
  created_at: string;
  updated_at: string;
};

export type ReactionVideo = {
  id: string;
  user_id: string;
  avatar_id: string;
  name: string;
  storage_path: string;
  duration_s: number | null;
  position_x: number;
  position_y: number;
  created_at: string;
};

export type PersonaReviewStatus = "draft" | "generated" | "approved";
export type PresenterVideoStatus =
  | "draft"
  | "script_pending_review"
  | "ready_for_video"
  | "submitted"
  | "processing"
  | "completed"
  | "error";

export type PresenterPersona = {
  id: string;
  user_id: string;
  avatar_id: string;
  raw_persona: string;
  structured_persona: Record<string, unknown>;
  status: PersonaReviewStatus;
  created_at: string;
  updated_at: string;
};

export type PresenterAvatarProfile = {
  id: string;
  user_id: string;
  avatar_id: string;
  main_topic: string;
  visual_prompt: string | null;
  visual_prompt_status: "draft" | "approved";
  heygen_avatar_group_id: string | null;
  heygen_avatar_id: string | null;
  heygen_preview_image_url: string | null;
  heygen_preview_video_url: string | null;
  default_voice_id: string | null;
  selected_voice_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PresenterVoiceOption = {
  id: string;
  user_id: string;
  avatar_id: string;
  voice_id: string;
  name: string;
  language: string | null;
  gender: string | null;
  preview_audio_url: string | null;
  seed: number | null;
  selected: boolean;
  created_at: string;
};

export type PresenterVideoProject = {
  id: string;
  user_id: string;
  avatar_id: string;
  topic: string;
  research_summary: Record<string, unknown>;
  script: Record<string, unknown>;
  script_text: string | null;
  status: PresenterVideoStatus;
  heygen_video_id: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  duration_s: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type SourceVideo = {
  id: string;
  user_id: string;
  avatar_id: string;
  name: string;
  storage_path: string;
  duration_s: number | null;
  source_type: "upload" | "url" | "instagram_profile";
  source_url: string | null;
  source_platform: string | null;
  source_external_id: string | null;
  source_username: string | null;
  thumbnail_path: string | null;
  source_published_at: string | null;
  view_count: number | null;
  like_count: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type MediaImport = {
  id: string;
  user_id: string;
  avatar_id: string;
  type: "url" | "instagram_profile";
  input: string;
  requested_limit: number;
  status: "pending" | "processing" | "completed" | "partial" | "error";
  total_items: number;
  processed_items: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export type SocialPlatform = "instagram" | "youtube";

export type ReelJobTarget = {
  id: string;
  job_id: string;
  account_id: string;
  platform: SocialPlatform;
  zernio_post_id: string | null;
  platform_post_url: string | null;
  status: PostStatus;
  error_message: string | null;
  posted_at: string | null;
  created_at: string;
};

export type SocialAccount = {
  id: string;
  user_id: string;
  avatar_id: string;
  zernio_profile_id: string;
  zernio_account_id: string;
  platform: SocialPlatform;
  username: string | null;
  display_name: string;
  profile_url: string | null;
  active: boolean;
  created_at: string;
};

export type Automation = {
  id: string;
  user_id: string;
  avatar_id: string;
  account_id: string;
  posts_per_day: number;
  post_times: string[];
  reaction_pool: string[];
  clip_urls: string[];
  caption_template: string;
  overlay_text: string;
  share_to_feed: boolean;
  active: boolean;
  created_at: string;
};

export type ReelJob = {
  id: string;
  user_id: string;
  avatar_id: string;
  automation_id: string | null;
  account_id: string | null;
  source_video_id: string | null;
  clip_url: string;
  reaction_id: string;
  overlay_text: string;
  caption: string;
  status: JobStatus;
  error_message: string | null;
  output_path: string | null;
  zernio_media_url: string | null;
  zernio_post_id: string | null;
  platform_post_url: string | null;
  scheduled_post_at: string | null;
  posted_at: string | null;
  created_at: string;
  reel_job_targets?: ReelJobTarget[];
};

export type PostHistory = {
  id: string;
  user_id: string;
  avatar_id: string;
  job_id: string;
  account_id: string;
  zernio_post_id: string | null;
  platform_post_url: string | null;
  status: PostStatus;
  error_message: string | null;
  posted_at: string | null;
  created_at: string;
};

export type TikTokSearchResult = {
  id: string;
  user_id: string;
  query: string;
  result_url: string;
  title: string | null;
  thumbnail_url: string | null;
  duration_s: number | null;
  view_count: number | null;
  uploader: string | null;
  raw: Record<string, unknown>;
  searched_at: string;
  expires_at: string;
};

export type ContentSearchPlatform = "youtube" | "tiktok" | "instagram";

export type ContentSearchResult = {
  id: string;
  user_id: string;
  avatar_id: string;
  query: string;
  platform: ContentSearchPlatform;
  result_url: string;
  external_id: string | null;
  title: string | null;
  thumbnail_url: string | null;
  duration_s: number | null;
  view_count: number | null;
  like_count: number | null;
  author_username: string | null;
  published_at: string | null;
  raw: Record<string, unknown>;
  searched_at: string;
  expires_at: string;
};

export type ContentSearchProviderStatus = {
  platform: ContentSearchPlatform;
  status: "ok" | "cached" | "unavailable" | "error";
  count: number;
  error?: string;
};

export type ContentSearchPageTokens = Partial<Record<ContentSearchPlatform, string>>;
