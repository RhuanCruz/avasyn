// ScrapeCreators provider — primary content engine for YouTube, TikTok and
// Instagram (https://docs.scrapecreators.com). Auth via `x-api-key` header.
//
// Both `search-content` (interactive search) and `automation-runner` use the
// keyword search; the Trends tab (`trend-scan`) also uses the trending feeds.
//
// Field mappings below were validated against live responses:
//   - YouTube search/trending  -> { shorts: [...], videos: [...] }, items have
//     id/url/title/viewCountInt and (trending only) thumbnail/durationMs/channel.
//   - TikTok keyword search     -> { search_item_list: [{ aweme_info: {...} }] }
//   - TikTok get-trending-feed  -> { aweme_list: [{...aweme}] }  (no wrapper)
//   - Instagram reels search    -> { reels: [{ shortcode, url, caption, ... }] }
//   - All three take the query parameter `query`.

import {
  firstString,
  getNestedString,
  getNestedValue,
  isRecord,
  type NormalizedResult,
  type Platform,
  type ProviderResult,
} from "./content-search.ts";

const BASE_URL = "https://api.scrapecreators.com";

export const SC_PLATFORMS: Platform[] = ["youtube", "tiktok", "instagram"];

export function hasScrapeCreatorsKey(): boolean {
  return Boolean(Deno.env.get("SCRAPECREATORS_API_KEY"));
}

export type TrendingOptions = {
  region?: string;
  // Instagram has no trending endpoint — a query is required to fall back to search.
  query?: string;
};

async function scFetch(path: string, params: Record<string, string | undefined>) {
  const apiKey = Deno.env.get("SCRAPECREATORS_API_KEY");
  if (!apiKey) {
    throw new Error("SCRAPECREATORS_API_KEY is not configured");
  }
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  const payload = await response.json().catch(() => null);
  // The API returns 200 with { success:false, message } for soft errors too.
  if (!response.ok || (isRecord(payload) && payload.success === false)) {
    const message = (isRecord(payload) && (payload.message ?? payload.error)) || response.statusText;
    throw new Error(`ScrapeCreators ${path}: ${String(message)}`);
  }
  return payload;
}

// --- Keyword search ---------------------------------------------------------

export async function fetchScrapeCreatorsSearch(
  platform: Platform,
  query: string,
  limit: number,
  cursor?: string,
): Promise<ProviderResult> {
  if (platform === "youtube") {
    const payload = await scFetch("/v1/youtube/search", { query, continuationToken: cursor });
    return normalizeYouTube(payload, limit);
  }
  if (platform === "tiktok") {
    const payload = await scFetch("/v1/tiktok/search/keyword", { query, cursor });
    return normalizeTikTok(payload, limit);
  }
  // instagram
  const payload = await scFetch("/v2/instagram/reels/search", { query, cursor });
  return normalizeInstagram(payload, limit);
}

// --- Trending feeds ---------------------------------------------------------

export async function fetchScrapeCreatorsTrending(
  platform: Platform,
  limit: number,
  options: TrendingOptions = {},
): Promise<ProviderResult> {
  const region = options.region ?? "BR";
  if (platform === "youtube") {
    const payload = await scFetch("/v1/youtube/shorts/trending", { region });
    return normalizeYouTube(payload, limit);
  }
  if (platform === "tiktok") {
    try {
      const payload = await scFetch("/v1/tiktok/videos/popular", { region });
      const result = normalizeTikTok(payload, limit);
      if (result.results.length > 0) return result;
    } catch (_error) {
      // `videos/popular` is frequently unavailable — fall back to the trending feed.
    }
    const feed = await scFetch("/v1/tiktok/get-trending-feed", { region });
    return normalizeTikTok(feed, limit);
  }
  // Instagram has no trending endpoint — fall back to reels search on the theme.
  if (!options.query) return { results: [], nextPageToken: null };
  return fetchScrapeCreatorsSearch("instagram", options.query, limit);
}

// --- Normalizers ------------------------------------------------------------

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function epochToIso(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // create_time / taken_at are in seconds; tolerate millisecond values too.
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  return new Date(ms).toISOString();
}

function normalizeYouTube(payload: unknown, limit: number): ProviderResult {
  const root = isRecord(payload) ? payload : {};
  // Short-form content lands in `shorts`; regular results in `videos`.
  const items = [...asList(root.shorts), ...asList(root.videos)];
  const nextPageToken = firstString(root.continuationToken, root.nextPageToken, root.cursor);

  const results: NormalizedResult[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = firstString(item.id, item.videoId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const durationMs = firstNumber(item.durationMs);
    results.push({
      platform: "youtube",
      resultUrl: firstString(item.url) ?? `https://www.youtube.com/shorts/${id}`,
      externalId: id,
      title: firstString(item.title),
      thumbnailUrl: firstString(item.thumbnail, item.thumbnailUrl) ??
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      durationS: durationMs != null ? Math.round(durationMs / 1000) : null,
      viewCount: firstNumber(item.viewCountInt, item.viewCount, item.views),
      likeCount: firstNumber(item.likeCountInt, item.likeCount),
      authorUsername: firstString(
        getNestedString(item, ["channel", "name"]),
        getNestedString(item, ["channel", "title"]),
        getNestedString(item, ["channel", "handle"]),
        item.channelName,
      ),
      publishedAt: firstString(item.publishDate, item.publishedAt, item.publishedTime),
      raw: item,
    });
    if (results.length >= limit) break;
  }
  return { results, nextPageToken };
}

function normalizeTikTok(payload: unknown, limit: number): ProviderResult {
  const root = isRecord(payload) ? payload : {};
  // Keyword search wraps each item in `aweme_info`; the trending feed does not.
  const items = root.search_item_list ? asList(root.search_item_list) : asList(root.aweme_list);
  const nextPageToken = firstString(root.max_cursor, root.cursor, root.nextCursor);

  const results: NormalizedResult[] = [];
  for (const entry of items) {
    if (!isRecord(entry)) continue;
    const item = isRecord(entry.aweme_info) ? entry.aweme_info : entry;
    const id = firstString(item.aweme_id, item.id, item.video_id);
    if (!id) continue;
    const author = firstString(
      getNestedString(item, ["author", "unique_id"]),
      getNestedString(item, ["author", "uniqueId"]),
      getNestedString(item, ["author", "nickname"]),
    );
    const durationMs = firstNumber(getNestedValue(item, ["video", "duration"]));
    results.push({
      platform: "tiktok",
      resultUrl: firstString(item.share_url, item.url, getNestedString(item, ["share_info", "share_url"])) ??
        `https://www.tiktok.com/@${author ?? "user"}/video/${id}`,
      externalId: id,
      title: firstString(item.desc, item.content_desc, item.title),
      thumbnailUrl: pickThumbFromList(getNestedValue(item, ["video", "cover", "url_list"])) ??
        pickThumbFromList(getNestedValue(item, ["video", "origin_cover", "url_list"])) ??
        pickThumbFromList(getNestedValue(item, ["video", "ai_dynamic_cover", "url_list"])),
      durationS: durationMs && durationMs > 0 ? Math.round(durationMs / 1000) : null,
      viewCount: firstNumber(getNestedValue(item, ["statistics", "play_count"])),
      likeCount: firstNumber(getNestedValue(item, ["statistics", "digg_count"])),
      authorUsername: author,
      publishedAt: epochToIso(item.create_time ?? item.createTime),
      raw: item,
    });
    if (results.length >= limit) break;
  }
  return { results, nextPageToken };
}

function normalizeInstagram(payload: unknown, limit: number): ProviderResult {
  const root = isRecord(payload) ? payload : {};
  const items = asList(root.reels);
  const nextPageToken = firstString(root.next_max_id, root.paging_token, root.cursor);

  const results: NormalizedResult[] = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const item = isRecord(raw.media) ? raw.media : isRecord(raw.node) ? raw.node : raw;
    const code = firstString(item.shortcode, item.code, item.short_code);
    const id = code ?? firstString(item.id, item.pk);
    if (!id) continue;
    results.push({
      platform: "instagram",
      resultUrl: firstString(item.url) ?? (code ? `https://www.instagram.com/reel/${code}/` : String(id)),
      externalId: code ?? String(id),
      title: firstString(item.caption, getNestedString(item, ["caption", "text"]), item.accessibility_caption),
      thumbnailUrl: firstString(item.thumbnail_src, item.display_url, item.thumbnail_url) ??
        pickThumbFromList(getNestedValue(item, ["image_versions2", "candidates"])),
      durationS: (() => {
        const d = firstNumber(item.video_duration, item.duration);
        return d != null ? Math.round(d) : null;
      })(),
      viewCount: firstNumber(item.video_view_count, item.video_play_count, item.play_count, item.view_count),
      likeCount: firstNumber(item.like_count, item.likes),
      authorUsername: firstString(
        getNestedString(item, ["owner", "username"]),
        getNestedString(item, ["user", "username"]),
      ),
      publishedAt: epochToIso(item.taken_at ?? item.taken_at_timestamp ?? item.device_timestamp),
      raw: item,
    });
    if (results.length >= limit) break;
  }
  return { results, nextPageToken };
}

// Pull the first usable URL out of either an array of {url} objects, an array
// of bare strings, or a single string (covers TikTok url_list / IG candidates).
function pickThumbFromList(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) return entry.trim();
    if (isRecord(entry)) {
      const url = firstString(entry.url, entry.src);
      if (url) return url;
    }
  }
  return null;
}
