// Shared content-search helpers used by both `search-content` (interactive search)
// and `automation-runner` (recurring automations). v1 actively supports YouTube
// Shorts; TikTok/Instagram live in `search-content` only.

export type Platform = "youtube" | "tiktok" | "instagram";

export type NormalizedResult = {
  platform: Platform;
  resultUrl: string;
  externalId: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  durationS: number | null;
  viewCount: number | null;
  likeCount: number | null;
  authorUsername: string | null;
  publishedAt: string | null;
  raw: Record<string, unknown>;
};

export type ProviderResult = {
  results: NormalizedResult[];
  nextPageToken: string | null;
};

export type YouTubeSearchOptions = {
  order: "relevance" | "date" | "viewCount";
  recentDays: number | null;
};

export async function fetchYouTubeResults(
  query: string,
  limit: number,
  pageToken?: string,
  options: YouTubeSearchOptions = { order: "relevance", recentDays: null },
): Promise<ProviderResult> {
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("videoDuration", "short");
  searchUrl.searchParams.set("maxResults", String(Math.min(25, Math.max(limit * 2, limit))));
  searchUrl.searchParams.set("order", options.order);
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("key", apiKey);
  if (pageToken) {
    searchUrl.searchParams.set("pageToken", pageToken);
  }
  if (options.recentDays) {
    searchUrl.searchParams.set(
      "publishedAfter",
      new Date(Date.now() - options.recentDays * 24 * 60 * 60 * 1000).toISOString(),
    );
  }

  const searchPayload = await fetchJson(searchUrl);
  const searchItems: unknown[] = Array.isArray(searchPayload.items) ? searchPayload.items : [];
  const videoIds = searchItems
    .map((item) => getNestedString(item, ["id", "videoId"]))
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (videoIds.length === 0) {
    return {
      results: [],
      nextPageToken: firstString(searchPayload.nextPageToken),
    };
  }

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("part", "snippet,contentDetails,statistics");
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("key", apiKey);

  const videosPayload = await fetchJson(videosUrl);
  const videos: unknown[] = Array.isArray(videosPayload.items) ? videosPayload.items : [];

  const results = videos
    .map((video): NormalizedResult | null => {
      const videoId = getNestedString(video, ["id"]);
      if (!videoId) return null;
      const durationS = parseIsoDuration(getNestedString(video, ["contentDetails", "duration"]));
      if (durationS && durationS > 180) return null;

      return {
        platform: "youtube",
        resultUrl: `https://www.youtube.com/shorts/${videoId}`,
        externalId: videoId,
        title: firstString(getNestedString(video, ["snippet", "title"])),
        thumbnailUrl: bestThumbnail(getNestedValue(video, ["snippet", "thumbnails"])),
        durationS,
        viewCount: nullableInteger(getNestedString(video, ["statistics", "viewCount"])),
        likeCount: nullableInteger(getNestedString(video, ["statistics", "likeCount"])),
        authorUsername: firstString(getNestedString(video, ["snippet", "channelTitle"])),
        publishedAt: firstString(getNestedString(video, ["snippet", "publishedAt"])),
        raw: isRecord(video) ? video : {},
      };
    })
    .filter((result): result is NormalizedResult => Boolean(result))
    .slice(0, limit);

  return {
    results,
    nextPageToken: firstString(searchPayload.nextPageToken),
  };
}

// Normalize a video URL into stable dedup keys. Used by automations to guarantee
// the same content is never reused for an avatar.
export function canonicalizeContentUrl(
  url: string,
): { platform: Platform | null; externalId: string | null; canonicalUrl: string } {
  const trimmed = (url ?? "").trim();
  const youtubeId = extractYouTubeId(trimmed);
  if (youtubeId) {
    return { platform: "youtube", externalId: youtubeId, canonicalUrl: `youtube:${youtubeId}` };
  }
  const tiktokMatch = trimmed.match(/\/video\/(\d+)/);
  if (tiktokMatch) {
    return { platform: "tiktok", externalId: tiktokMatch[1], canonicalUrl: `tiktok:${tiktokMatch[1]}` };
  }
  // Fallback: clean URL without querystring/hash.
  const clean = trimmed.split(/[?#]/)[0].replace(/\/$/, "");
  return { platform: null, externalId: null, canonicalUrl: clean || trimmed };
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /youtube\.com\/shorts\/([\w-]+)/i,
    /youtu\.be\/([\w-]+)/i,
    /youtube\.com\/watch\?(?:.*&)?v=([\w-]+)/i,
    /youtube\.com\/embed\/([\w-]+)/i,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function fetchJson(url: URL) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message ?? response.statusText;
    throw new Error(String(message));
  }
  return payload;
}

export function parseIsoDuration(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function bestThumbnail(thumbnails: unknown) {
  if (!thumbnails || typeof thumbnails !== "object") return null;
  const record = thumbnails as Record<string, { url?: unknown }>;
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const url = record[key]?.url;
    if (typeof url === "string" && url.trim()) return url;
  }
  return null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function nullableInteger(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

function getNestedString(value: unknown, path: string[]) {
  const nested = getNestedValue(value, path);
  return typeof nested === "string" && nested.trim() ? nested.trim() : null;
}

function getNestedValue(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return current;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
