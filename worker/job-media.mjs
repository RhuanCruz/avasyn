export function getClipSource(job) {
  if (job.source_video_id || String(job.clip_url ?? "").startsWith("source-video:")) {
    const storagePath = job.source_videos?.storage_path;
    if (!storagePath) {
      throw new Error("Source video not found");
    }

    return { type: "storage", path: storagePath };
  }

  return { type: "url", url: job.clip_url };
}

export function getSourceVideoIdFromClipUrl(clipUrl) {
  const value = String(clipUrl ?? "");
  return value.startsWith("source-video:") ? value.slice("source-video:".length) : null;
}
