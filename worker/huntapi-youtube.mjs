const defaultEndpoint = "https://api.huntapi.com/v1/video/download";

export function buildHuntApiVideoDownloadRequest({
  apiKey,
  downloadType = "audio_video",
  endpoint = defaultEndpoint,
  maxDuration = 300,
  sourceUrl,
  videoFormat = "mp4",
  videoQuality = "best",
}) {
  if (!apiKey) throw new Error("HUNTAPI_API_KEY is not configured");
  if (!sourceUrl) throw new Error("sourceUrl is required");

  const url = new URL(endpoint);
  url.searchParams.set("query", sourceUrl);
  url.searchParams.set("download_type", downloadType);
  url.searchParams.set("max_duration", String(maxDuration));
  url.searchParams.set("video_quality", videoQuality);
  url.searchParams.set("video_format", videoFormat);

  return {
    headers: { "x-api-key": apiKey },
    url: url.toString(),
  };
}

export async function runHuntApiYouTubeDownloader({
  apiKey,
  downloadType,
  endpoint,
  fetchImpl = fetch,
  maxDuration,
  pollIntervalMs = 2000,
  sleepImpl = sleep,
  sourceUrl,
  timeoutSeconds = 600,
  videoFormat,
  videoQuality,
}) {
  const request = buildHuntApiVideoDownloadRequest({
    apiKey,
    downloadType,
    endpoint,
    maxDuration,
    sourceUrl,
    videoFormat,
    videoQuality,
  });

  const created = await fetchJson(fetchImpl, request.url, {
    headers: request.headers,
    method: "GET",
  });
  const jobId = created.payload?.job_id ?? created.payload?.id;
  if (!created.ok || !jobId) {
    throw new Error(`HuntAPI request failed: ${created.status} ${extractErrorMessage(created.payload) ?? "missing job_id"}`);
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  const jobUrl = buildHuntApiJobUrl(request.url, jobId);
  let lastPayload = created.payload;

  while (Date.now() <= deadline) {
    const job = await fetchJson(fetchImpl, jobUrl, {
      headers: request.headers,
      method: "GET",
    });
    lastPayload = job.payload;
    if (!job.ok) {
      throw new Error(`HuntAPI job request failed: ${job.status} ${extractErrorMessage(job.payload) ?? "unknown error"}`);
    }

    if (isHuntApiFailedJob(job.payload)) {
      throw new Error(`HuntAPI failed to download YouTube video: ${extractErrorMessage(job.payload) ?? job.payload?.status ?? "failed"}`);
    }

    if (isHuntApiCompletedJob(job.payload)) {
      const downloadUrl = findHuntApiYouTubeDownloadUrl(job.payload);
      if (!downloadUrl) {
        const keys = job.payload && typeof job.payload === "object" ? Object.keys(job.payload).join(",") : "none";
        throw new Error(`HuntAPI did not return a downloadable YouTube video URL. keys=${keys}`);
      }
      return { ...job.payload, download_url: downloadUrl };
    }

    await sleepImpl(pollIntervalMs);
  }

  throw new Error(`HuntAPI job ${jobId} timed out after ${timeoutSeconds}s. Last status: ${lastPayload?.status ?? "unknown"}`);
}

export function buildHuntApiJobUrl(downloadUrl, jobId) {
  const parsed = new URL(downloadUrl);
  return `${parsed.origin}/v1/jobs/${encodeURIComponent(jobId)}`;
}

export function findHuntApiYouTubeDownloadUrl(raw) {
  if (!raw || typeof raw !== "object") return null;
  const direct = firstString(
    raw.download_url,
    raw.downloadUrl,
    raw.file_url,
    raw.fileUrl,
    raw.video_url,
    raw.videoUrl,
    raw.url,
    raw.result?.response,
    raw.result?.download_url,
    raw.result?.downloadUrl,
    raw.result?.file_url,
    raw.result?.fileUrl,
    raw.result?.video_url,
    raw.result?.videoUrl,
    raw.result?.url,
  );
  if (isDownloadableUrl(direct)) return direct;
  return findNestedDownloadableUrl(raw);
}

export function normalizeHuntApiYouTubeCandidate(raw, sourceUrl) {
  const videoId = extractYouTubeId(sourceUrl);
  const metadata = raw?.result?.metadata && typeof raw.result.metadata === "object"
    ? raw.result.metadata
    : raw?.metadata && typeof raw.metadata === "object"
      ? raw.metadata
      : raw;
  const title = firstString(metadata?.title, raw?.title) ?? (videoId ? `YouTube ${videoId}` : "YouTube video");
  const thumbnail = firstString(
    metadata?.thumbnail,
    metadata?.thumbnail_url,
    metadata?.thumbnailUrl,
    raw?.thumbnail,
    raw?.thumbnail_url,
    raw?.thumbnailUrl,
  );

  return {
    externalId: videoId ?? sourceUrl,
    platform: "youtube",
    sourceUrl,
    metadata: {
      id: videoId,
      title,
      thumbnail,
      provider: "huntapi",
      ...copyObject(metadata),
    },
  };
}

async function fetchJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  const payload = parseJson(text);
  return {
    ok: response.ok,
    payload,
    status: response.status,
  };
}

function isHuntApiCompletedJob(raw) {
  return raw?.status === "CompletedJob" || raw?.status === "completed" || raw?.success === true;
}

function isHuntApiFailedJob(raw) {
  return raw?.status === "FailedJob" || raw?.status === "failed" || raw?.success === false || raw?.error;
}

function findNestedDownloadableUrl(value, seen = new Set()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedDownloadableUrl(item, seen);
      if (found) return found;
    }
    return null;
  }

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && isLikelyVideoUrlKey(key) && isDownloadableUrl(item, key)) {
      return item.trim();
    }
  }

  for (const item of Object.values(value)) {
    if (item && typeof item === "object") {
      const found = findNestedDownloadableUrl(item, seen);
      if (found) return found;
    }
  }

  return null;
}

function isLikelyVideoUrlKey(key) {
  return /response|url|link|href|download|file|video|media/i.test(key);
}

function isDownloadableUrl(value, key = "") {
  if (!value || typeof value !== "string") return false;
  if (/thumb|thumbnail|cover|image|poster/i.test(key)) return false;
  const url = value.trim();
  if (!/^https?:\/\//i.test(url)) return false;
  if (/youtube\.com|youtu\.be/i.test(url)) return false;
  if (/\.(?:jpe?g|png|webp|gif|avif)(?:$|[?#])/i.test(url)) return false;
  return true;
}

function extractErrorMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  return firstString(
    raw.message,
    raw.error,
    raw.error_message,
    raw.errorMessage,
    raw.detail,
    raw.statusText,
    raw.result?.message,
    raw.result?.error,
  );
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HuntAPI returned non-JSON response: ${text.slice(0, 160)}`);
  }
}

function extractYouTubeId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.replace("/", "") || null;
    }
    if (parsed.pathname.startsWith("/shorts/")) {
      return parsed.pathname.split("/").filter(Boolean)[1] ?? null;
    }
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

function copyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
