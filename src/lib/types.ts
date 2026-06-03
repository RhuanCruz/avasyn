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

export type ReactionVideo = {
  id: string;
  user_id: string;
  name: string;
  storage_path: string;
  duration_s: number | null;
  created_at: string;
};

export type SocialAccount = {
  id: string;
  user_id: string;
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
  automation_id: string | null;
  account_id: string | null;
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
  job_id: string;
  account_id: string;
  zernio_post_id: string | null;
  platform_post_url: string | null;
  status: PostStatus;
  error_message: string | null;
  posted_at: string | null;
  created_at: string;
};
