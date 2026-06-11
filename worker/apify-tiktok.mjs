export function buildTikTokSearchInput(query, limit) {
  return {
    search: [query],
    resultsPerPage: limit,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
    scrapeRelatedVideos: false,
    maxProfilesPerQuery: 0,
  };
}

export function buildTikTokDownloadInput(url) {
  return {
    postURLs: [url],
    shouldDownloadVideos: true,
    shouldDownloadCovers: true,
    shouldDownloadSubtitles: false,
    shouldDownloadSlideshowImages: false,
    scrapeRelatedVideos: false,
  };
}

export async function runApifyTikTokActor({
  actorId = "clockworks/tiktok-scraper",
  fetchImpl = fetch,
  input,
  limit = 1,
  token,
  timeoutSeconds = 180,
}) {
  const normalizedActorId = actorId.replace("/", "~");
  const endpoint = new URL(
    `https://api.apify.com/v2/actors/${normalizedActorId}/run-sync-get-dataset-items`,
  );
  endpoint.searchParams.set("token", token);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("clean", "true");
  endpoint.searchParams.set("limit", String(limit));
  endpoint.searchParams.set("maxItems", String(limit));
  endpoint.searchParams.set("timeout", String(timeoutSeconds));

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.error?.type ?? response.statusText;
    throw new Error(String(message));
  }

  return Array.isArray(payload) ? payload : [];
}

export function findApifyTikTokVideoDownloadUrl(raw) {
  const mediaUrls = Array.isArray(raw?.mediaUrls) ? raw.mediaUrls : [];
  for (const item of mediaUrls) {
    const url = firstString(item?.downloadLink, item?.url, item?.tiktokLink);
    const type = firstString(item?.type, item?.mimeType, item?.contentType);
    if (url && (type?.includes("video") || url.includes(".mp4"))) return url;
  }

  return firstString(
    raw?.videoMeta?.downloadAddr,
    raw?.videoMeta?.downloadUrl,
    raw?.videoMeta?.playAddr,
    raw?.downloadUrl,
  );
}

export function normalizeApifyTikTokSearchResult(raw) {
  if (!raw || raw.errorCode) return null;
  const resultUrl = firstString(raw.webVideoUrl, raw.submittedVideoUrl, raw.url);
  if (!resultUrl || !resultUrl.startsWith("http")) return null;

  return {
    resultUrl,
    title: firstString(raw.text) ?? "Sem título",
    thumbnailUrl: firstString(raw.videoMeta?.coverUrl, raw.videoMeta?.originalCoverUrl),
    durationS: nullableNumber(raw.videoMeta?.duration),
    viewCount: nullableNumber(raw.playCount),
    uploader: firstString(raw.authorMeta?.name),
    raw,
  };
}

export function normalizeApifyTikTokVideoCandidate(raw, sourceUrl) {
  const externalId = firstString(raw?.id) ?? extractTikTokExternalId(sourceUrl);
  return {
    externalId,
    platform: "tiktok",
    sourceUrl: firstString(raw?.webVideoUrl, raw?.submittedVideoUrl) ?? sourceUrl,
    metadata: {
      ...raw,
      id: externalId,
      title: firstString(raw?.text) ?? "TikTok importado",
      description: firstString(raw?.text),
      uploader: firstString(raw?.authorMeta?.name),
      duration: nullableNumber(raw?.videoMeta?.duration),
      timestamp: nullableNumber(raw?.createTime),
      view_count: nullableNumber(raw?.playCount),
      like_count: nullableNumber(raw?.diggCount),
    },
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractTikTokExternalId(url) {
  const match = String(url).match(/\/video\/(\d+)/);
  return match?.[1] ?? null;
}
