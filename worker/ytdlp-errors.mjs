const MAX_DETAIL_LENGTH = 400;

const PLATFORM_LABELS = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  direct: "this URL",
};

// yt-dlp writes a lot of noise to stderr (deprecation notices, per-fragment
// warnings). Keep the ERROR lines when there are any, otherwise the tail, so
// the message stored on the job/import row stays readable.
export function summarizeYtDlpStderr(stderr) {
  const lines = String(stderr ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";

  const errorLines = lines.filter((line) => /^ERROR\b/i.test(line));
  const kept = errorLines.length > 0 ? errorLines : lines.slice(-2);
  const joined = kept.join(" ").replace(/\s+/g, " ").trim();

  return joined.length > MAX_DETAIL_LENGTH
    ? `${joined.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : joined;
}

// Turns raw yt-dlp stderr into a message that names the actual fix. The
// frontend keys off these strings, so keep the distinctive tokens stable.
export function describeYtDlpFailure(platform, stderr) {
  const label = PLATFORM_LABELS[platform] ?? PLATFORM_LABELS.direct;
  const raw = String(stderr ?? "");
  const detail = summarizeYtDlpStderr(raw);
  const suffix = detail ? ` yt-dlp: ${detail}` : "";

  if (/no impersonate target is available|impersonate target|--impersonate/i.test(raw)) {
    return (
      `yt-dlp cannot impersonate a browser, which the ${label} extractor requires. `
      + "Rebuild the video worker image so yt-dlp is installed with the curl-cffi extra "
      + `(yt-dlp[default,curl-cffi]).${suffix}`
    );
  }

  if (/Sign in to confirm you.?re not a bot|confirm your age|cookies-from-browser/i.test(raw)) {
    return (
      `${label} is bot-checking the worker. Refresh YOUTUBE_COOKIES_BASE64 with a freshly `
      + `exported Netscape cookies.txt and redeploy the worker.${suffix}`
    );
  }

  if (/HTTP Error 429|Too Many Requests|rate.?limit/i.test(raw)) {
    return `${label} is rate-limiting the worker. Retry later or route this download through a proxy.${suffix}`;
  }

  if (/Video unavailable|This video is private|has been removed|Private video|account is private/i.test(raw)) {
    return `${label} says this video is private or unavailable, so it cannot be downloaded.${suffix}`;
  }

  if (/Unsupported URL|Unable to handle request/i.test(raw)) {
    return `yt-dlp does not support this ${label} URL.${suffix}`;
  }

  if (/File is larger than max-filesize|larger than max-filesize/i.test(raw)) {
    return `This ${label} video is larger than the worker's 300M download limit.${suffix}`;
  }

  if (/Requested format is not available|No video formats found/i.test(raw)) {
    return (
      `yt-dlp found no downloadable MP4 format for this ${label} video. `
      + `The extractor is likely out of date — rebuild the worker image.${suffix}`
    );
  }

  return `yt-dlp failed to download this ${label} video.${suffix}`;
}
