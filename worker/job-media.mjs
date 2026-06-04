export function getClipSource(job) {
  if (job.source_video_id) {
    const storagePath = job.source_videos?.storage_path;
    if (!storagePath) {
      throw new Error("Source video not found");
    }

    return { type: "storage", path: storagePath };
  }

  return { type: "url", url: job.clip_url };
}
