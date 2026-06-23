import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";
import {
  canonicalizeContentUrl,
  type NormalizedResult,
  nullableInteger,
  type Platform,
} from "../_shared/content-search.ts";
import {
  fetchScrapeCreatorsSearch,
  fetchScrapeCreatorsTrending,
  hasScrapeCreatorsKey,
} from "../_shared/scrapecreators.ts";

type ServiceClient = ReturnType<typeof createServiceClient>;

const ALL_PLATFORMS: Platform[] = ["youtube", "tiktok", "instagram"];
const PER_PLATFORM_LIMIT = 15;
const TTL_HOURS = 6;
// A short video pulling this many views per hour is treated as already trending.
const TRENDING_VELOCITY = 5000;

type TrendWatch = {
  id: string;
  user_id: string;
  avatar_id: string;
  theme: string;
  platforms: string[];
  active: boolean;
  last_refreshed_at: string | null;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    if (!hasScrapeCreatorsKey()) {
      throw new Error("SCRAPECREATORS_API_KEY não configurada — busca de trends indisponível.");
    }

    const user = await getAuthenticatedUser(request);
    const body = await request.json().catch(() => ({}));
    const mode = normalizeMode(body.mode);
    const force = body.force === true;

    const service = createServiceClient();
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);

    const watches = await loadWatches(service, user.id, avatar.id, body.trendWatchId);
    let refreshed = 0;

    for (const watch of watches) {
      if (!force && isFresh(watch.last_refreshed_at)) continue;
      await refreshWatch(service, watch, mode);
      refreshed++;
    }

    const videos = await loadVideos(service, user.id, avatar.id);
    return jsonResponse({ refreshed, videos });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function normalizeMode(value: unknown): "trending" | "search" | "both" {
  return value === "trending" || value === "search" ? value : "both";
}

function isFresh(lastRefreshedAt: string | null): boolean {
  if (!lastRefreshedAt) return false;
  const elapsedHours = (Date.now() - Date.parse(lastRefreshedAt)) / 3_600_000;
  return Number.isFinite(elapsedHours) && elapsedHours < TTL_HOURS;
}

async function loadWatches(
  service: ServiceClient,
  userId: string,
  avatarId: string,
  trendWatchId: unknown,
): Promise<TrendWatch[]> {
  let query = service
    .from("trend_watches")
    .select("*")
    .eq("user_id", userId)
    .eq("avatar_id", avatarId)
    .eq("active", true);
  if (typeof trendWatchId === "string" && trendWatchId) {
    query = query.eq("id", trendWatchId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as TrendWatch[];
}

function watchPlatforms(watch: TrendWatch): Platform[] {
  const requested = (watch.platforms ?? []).filter((p): p is Platform =>
    ALL_PLATFORMS.includes(p as Platform)
  );
  return requested.length > 0 ? requested : ALL_PLATFORMS;
}

async function refreshWatch(
  service: ServiceClient,
  watch: TrendWatch,
  mode: "trending" | "search" | "both",
) {
  const platforms = watchPlatforms(watch);
  const merged = new Map<string, { result: NormalizedResult; fromTrending: boolean }>();

  await Promise.all(platforms.map(async (platform) => {
    const collect = (results: NormalizedResult[], fromTrending: boolean) => {
      for (const result of results) {
        const { canonicalUrl } = canonicalizeContentUrl(result.resultUrl);
        const key = `${platform}:${canonicalUrl}`;
        const existing = merged.get(key);
        if (existing) {
          existing.fromTrending = existing.fromTrending || fromTrending;
        } else {
          merged.set(key, { result, fromTrending });
        }
      }
    };

    if (mode === "trending" || mode === "both") {
      try {
        const trending = await fetchScrapeCreatorsTrending(platform, PER_PLATFORM_LIMIT, {
          query: watch.theme,
        });
        collect(trending.results, true);
      } catch (_error) { /* skip platform on failure */ }
    }
    if (mode === "search" || mode === "both") {
      try {
        const search = await fetchScrapeCreatorsSearch(platform, watch.theme, PER_PLATFORM_LIMIT);
        collect(search.results, false);
      } catch (_error) { /* skip platform on failure */ }
    }
  }));

  const rows = Array.from(merged.values()).map(({ result, fromTrending }) => {
    const { canonicalUrl, externalId } = canonicalizeContentUrl(result.resultUrl);
    const score = trendScore(result);
    return {
      user_id: watch.user_id,
      avatar_id: watch.avatar_id,
      trend_watch_id: watch.id,
      platform: result.platform,
      external_id: result.externalId ?? externalId,
      canonical_url: canonicalUrl,
      source_url: result.resultUrl,
      title: result.title,
      thumbnail_url: result.thumbnailUrl,
      duration_s: nullableInteger(result.durationS),
      view_count: nullableInteger(result.viewCount),
      like_count: nullableInteger(result.likeCount),
      author_username: result.authorUsername,
      published_at: result.publishedAt,
      is_trending: fromTrending || score >= TRENDING_VELOCITY,
      trend_score: Math.round(score),
      raw: result.raw,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + TTL_HOURS * 3_600_000).toISOString(),
    };
  });

  if (rows.length > 0) {
    const { error } = await service
      .from("trend_videos")
      .upsert(rows, { onConflict: "trend_watch_id,platform,canonical_url" });
    if (error) throw error;
  }

  await service
    .from("trend_watches")
    .update({ last_refreshed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", watch.id);
}

// View velocity (views per hour since publish) approximates momentum. When the
// publish date is unknown we fall back to raw view count scaled down.
function trendScore(result: NormalizedResult): number {
  const views = result.viewCount ?? 0;
  if (!result.publishedAt) return views / 24;
  const ageHours = Math.max(1, (Date.now() - Date.parse(result.publishedAt)) / 3_600_000);
  if (!Number.isFinite(ageHours)) return views / 24;
  return views / ageHours;
}

async function loadVideos(service: ServiceClient, userId: string, avatarId: string) {
  const { data, error } = await service
    .from("trend_videos")
    .select("*")
    .eq("user_id", userId)
    .eq("avatar_id", avatarId)
    .order("trend_score", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}
