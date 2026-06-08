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

export type Avatar = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  status: AvatarStatus;
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

export type SocialAccount = {
  id: string;
  user_id: string;
  avatar_id: string;
  zernio_profile_id: string;
  zernio_account_id: string;
  platform: "instagram";
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
