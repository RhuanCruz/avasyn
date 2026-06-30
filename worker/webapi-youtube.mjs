const defaultEndpoint = "https://api.piloterr.com/v2/youtube/video/download";

export function buildWebApiYouTubeRequest({
  apiKey,
  authMode = "x-api-key",
  endpoint = defaultEndpoint,
  format = "720",
  sourceUrl,
}) {
  if (!apiKey) throw new Error("WEBAPI_YOUTUBE_API_KEY is not configured");
  if (!sourceUrl) throw new Error("sourceUrl is required");

  const headers = { "Content-Type": "application/json" };
  const url = new URL(endpoint);

  if (authMode === "bearer") {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (authMode === "query") {
    url.searchParams.set("apikey", apiKey);
  } else {
    headers["x-api-key"] = apiKey;
  }

  return {
    body: {
      format,
      query: sourceUrl,
    },
    headers,
    url: url.toString(),
  };
}

export async function runWebApiYouTubeDownloader({
  apiKey,
  authMode,
  endpoint,
  fetchImpl = fetch,
  format,
  sourceUrl,
}) {
  const request = buildWebApiYouTubeRequest({
    apiKey,
    authMode,
    endpoint,
    format,
    sourceUrl,
  });

  const response = await fetchImpl(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    const message = extractErrorMessage(payload) ?? response.statusText;
    throw new Error(`WebAPI request failed: ${response.status} ${message}`);
  }

  assertWebApiSuccess(payload);
  const downloadUrl = findWebApiYouTubeDownloadUrl(payload);
  if (!downloadUrl) {
    const keys = payload && typeof payload === "object" ? Object.keys(payload).join(",") : "none";
    throw new Error(`WebAPI did not return a downloadable YouTube video URL. keys=${keys}`);
  }

  return { ...payload, download_url: downloadUrl };
}

export function findWebApiYouTubeDownloadUrl(raw) {
  if (!raw || typeof raw !== "object") return null;

  const direct = firstString(
    raw.download_url,
    raw.downloadUrl,
    raw.file_url,
    raw.fileUrl,
    raw.video_url,
    raw.videoUrl,
    raw.media_url,
    raw.mediaUrl,
    raw.link,
    raw.url,
    raw.result,
    raw.result?.download_url,
    raw.result?.downloadUrl,
    raw.result?.file_url,
    raw.result?.fileUrl,
    raw.result?.video_url,
    raw.result?.videoUrl,
    raw.result?.url,
    raw.data?.download_url,
    raw.data?.downloadUrl,
    raw.data?.file_url,
    raw.data?.fileUrl,
    raw.data?.video_url,
    raw.data?.videoUrl,
    raw.data?.url,
  );
  if (isDownloadableUrl(direct)) return direct;

  return findNestedDownloadableUrl(raw);
}

export function normalizeWebApiYouTubeCandidate(raw, sourceUrl) {
  const videoId = extractYouTubeId(sourceUrl);
  const metadata = raw?.data && typeof raw.data === "object" ? raw.data : raw;
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
      provider: "webapi",
      ...copyObject(raw),
    },
  };
}

function assertWebApiSuccess(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("WebAPI returned an empty response");
  }

  if (raw.success === false || raw.ok === false || raw.status === "failed" || raw.error) {
    throw new Error(extractErrorMessage(raw) ?? "WebAPI failed to download YouTube video");
  }
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
  );
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
  return /url|link|href|download|file|video|media/i.test(key);
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
    throw new Error(`WebAPI returned non-JSON response: ${text.slice(0, 160)}`);
  }
}

function extractYouTubeId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.replace("/", "") || null;
    }
    if (parsed.pathname.startsWith("/shorts/")) {
      return parsed.pathname.split("/")[2] ?? null;
    }
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

function copyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
