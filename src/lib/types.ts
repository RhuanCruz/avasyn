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

export type PresenterVisualStatus = "not_started" | "in_review" | "approved" | "error";
export type PresenterVoiceStatus =
  | "not_configured"
  | "public_selected"
  | "clone_processing"
  | "clone_ready"
  | "error";
export type PresenterImageKind = "option" | "base" | "variation" | "upload";
export type PresenterImageSource = "hedra" | "upload";
export type PresenterImageStatus = "draft" | "generated" | "selected" | "approved" | "rejected" | "error";
export type PresenterImageSetStatus =
  | "draft"
  | "generating_options"
  | "options_generated"
  | "base_selected"
  | "generating_variations"
  | "ready_for_review"
  | "approved"
  | "error";

export type HedraModel = {
  aspectRatios: string[];
  id: string;
  maxDurationMs: number | null;
  name: string;
  requiresAudioInput: boolean;
  requiresStartFrame: boolean;
  resolutions: string[];
  type: string;
  creditCost: number | null;
  unitScale: number | null;
  billingUnit: string | null;
};

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
  visual_provider: "hedra" | "upload" | "legacy_heygen";
  video_provider: "hedra" | "legacy_heygen";
  voice_provider: "hedra" | "legacy_heygen";
  visual_status: PresenterVisualStatus;
  voice_status: PresenterVoiceStatus;
  approved_image_set_id: string | null;
  approved_base_image_id: string | null;
  hedra_voice_id: string | null;
  hedra_image_model_id: string | null;
  hedra_video_model_id: string | null;
  hedra_image_asset_id: string | null;
  hedra_voice_generation_id: string | null;
  voice_metadata: Record<string, unknown>;
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

export type PresenterImageSet = {
  id: string;
  user_id: string;
  avatar_id: string;
  base_image_id: string | null;
  status: PresenterImageSetStatus;
  prompt_original: string | null;
  prompt_improved: string | null;
  image_model_id: string | null;
  provider: PresenterImageSource;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PresenterAvatarImage = {
  id: string;
  user_id: string;
  avatar_id: string;
  image_set_id: string | null;
  kind: PresenterImageKind;
  source: PresenterImageSource;
  status: PresenterImageStatus;
  prompt: string | null;
  improved_prompt: string | null;
  variation_label: string | null;
  storage_path: string | null;
  preview_url: string | null;
  provider: PresenterImageSource;
  provider_asset_id: string | null;
  provider_generation_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PresenterVideoFormat = "falado" | "roteirizado";

export type PresenterVideoProject = {
  id: string;
  user_id: string;
  avatar_id: string;
  topic: string;
  format: PresenterVideoFormat;
  total_duration_s: number;
  research_summary: Record<string, unknown>;
  script: Record<string, unknown>;
  script_text: string | null;
  status: PresenterVideoStatus;
  heygen_video_id: string | null;
  provider: "hedra" | "legacy_heygen";
  hedra_generation_id: string | null;
  hedra_video_asset_id: string | null;
  image_asset_id: string | null;
  voice_id: string | null;
  video_model_id: string | null;
  render_metadata: Record<string, unknown>;
  video_url: string | null;
  thumbnail_url: string | null;
  duration_s: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type SceneKind = "fala" | "imagem";
export type SceneContentStatus = "empty" | "draft" | "generating" | "ready" | "error";
export type SceneClipStatus = "idle" | "queued" | "rendering" | "ready" | "error";
export type SceneImageSource = "upload" | "library" | "generated";
export type CameraMovement = "none" | "zoomin" | "zoomout" | "left" | "right" | "up";
export type SceneImageStyle = "realista" | "cine" | "ilustra" | "3d";

export type PresenterVideoScene = {
  id: string;
  user_id: string;
  avatar_id: string;
  project_id: string;
  position: number;
  kind: SceneKind;
  content_status: SceneContentStatus;
  duration_s: number;
  camera_movement: CameraMovement;
  image_style: SceneImageStyle;
  text: string | null;
  prompt: string | null;
  improved_prompt: string | null;
  narration: string | null;
  image_id: string | null;
  image_source: SceneImageSource | null;
  hedra_image_asset_id: string | null;
  hedra_generation_id: string | null;
  clip_status: SceneClipStatus;
  clip_generation_id: string | null;
  clip_url: string | null;
  clip_thumbnail_url: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
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

export type AutomationStatus = "draft" | "active" | "paused" | "error";
export type AutomationTextMode = "fixed" | "ideas" | "ai";
export type AutomationOverlayMode = "none" | "fixed" | "ideas" | "ai";
export type AutomationApprovalMode = "auto" | "review";
export type AutomationRunStatus =
  | "pending"
  | "searching"
  | "reserved"
  | "job_created"
  | "no_candidate"
  | "error";
export type ContentUsageStatus =
  | "reserved"
  | "job_created"
  | "rendered"
  | "posted"
  | "failed";
export type AutomationCandidateStatus =
  | "found"
  | "skipped_used"
  | "skipped_filter"
  | "reserved"
  | "failed";

export type Automation = {
  id: string;
  user_id: string;
  avatar_id: string;
  account_id: string | null;
  account_ids: string[];
  name: string;
  status: AutomationStatus;
  source_platforms: string[];
  search_queries: string[];
  days_of_week: number[];
  timezone: string;
  overlay_mode: AutomationOverlayMode;
  overlay_text: string;
  overlay_ideas: string[];
  overlay_ai_instructions: string;
  caption_mode: AutomationTextMode;
  caption_template: string;
  caption_ideas: string[];
  caption_ai_instructions: string;
  approval_mode: AutomationApprovalMode;
  min_view_count: number;
  max_duration_s: number;
  recent_days: number;
  posts_per_day: number;
  post_times: string[];
  reaction_pool: string[];
  share_to_feed: boolean;
  active: boolean;
  last_run_at: string | null;
  last_error_message: string | null;
  // Legacy column kept for backward compatibility.
  clip_urls: string[];
  updated_at: string;
  created_at: string;
};

export type AutomationRun = {
  id: string;
  user_id: string;
  avatar_id: string;
  automation_id: string;
  scheduled_slot_at: string;
  status: AutomationRunStatus;
  query: string | null;
  source_platform: string | null;
  candidate_url: string | null;
  content_usage_id: string | null;
  reel_job_id: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
};

export type AutomationCandidate = {
  id: string;
  user_id: string;
  avatar_id: string;
  automation_id: string;
  run_id: string | null;
  source_platform: string;
  source_external_id: string | null;
  source_url: string;
  canonical_url: string;
  title: string | null;
  thumbnail_url: string | null;
  duration_s: number | null;
  view_count: number | null;
  published_at: string | null;
  status: AutomationCandidateStatus;
  skip_reason: string | null;
  raw: Record<string, unknown>;
  created_at: string;
};

export type ContentUsage = {
  id: string;
  user_id: string;
  avatar_id: string;
  automation_id: string | null;
  source_platform: string;
  source_external_id: string | null;
  canonical_url: string;
  source_url: string;
  source_video_id: string | null;
  reel_job_id: string | null;
  status: ContentUsageStatus;
  used_at: string;
  error_message: string | null;
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

export type TrendWatch = {
  id: string;
  user_id: string;
  avatar_id: string;
  theme: string;
  platforms: ContentSearchPlatform[];
  active: boolean;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TrendVideo = {
  id: string;
  user_id: string;
  avatar_id: string;
  trend_watch_id: string;
  platform: ContentSearchPlatform;
  external_id: string | null;
  canonical_url: string;
  source_url: string;
  title: string | null;
  thumbnail_url: string | null;
  duration_s: number | null;
  view_count: number | null;
  like_count: number | null;
  author_username: string | null;
  published_at: string | null;
  is_trending: boolean;
  trend_score: number;
  raw: Record<string, unknown>;
  fetched_at: string;
  expires_at: string;
};
