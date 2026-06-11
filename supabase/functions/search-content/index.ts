import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";
import {
  buildTikTokSearchInput,
  normalizeApifyTikTokSearchItem,
  runApifyActorDataset,
} from "./apify.ts";

type Platform = "youtube" | "tiktok" | "instagram";

type NormalizedResult = {
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

type ProviderStatus = {
  platform: Platform;
  status: "ok" | "cached" | "unavailable" | "error";
  count: number;
  error?: string;
};

type ProviderResult = {
  results: NormalizedResult[];
  nextPageToken: string | null;
};

type WorkerTikTokResult = {
  resultUrl: string;
  title: string | null;
  thumbnailUrl: string | null;
  durationS: number | null;
  viewCount: number | null;
  uploader: string | null;
  raw: Record<string, unknown>;
};

const supportedPlatforms: Platform[] = ["youtube", "tiktok", "instagram"];

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const body = await request.json();
    const query = String(body.query ?? "").trim().replace(/\s+/g, " ");
    const limit = clampLimit(body.limitPerPlatform ?? body.limit);
    const requestedPlatforms = normalizePlatforms(body.platforms);
    const pageTokens = normalizePageTokens(body.pageTokens);
    const order = normalizeOrder(body.order);
    const recentDays = normalizeRecentDays(body.recentDays);
    const isPageRequest = Object.keys(pageTokens).length > 0;

    if (query.length < 2) {
      throw new Error("query is required");
    }

    const service = createServiceClient();
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);
    if (isPageRequest) {
      const pageResponse = await fetchAndStorePageResults({
        avatarId: avatar.id,
        limit,
        order,
        pageTokens,
        platforms: requestedPlatforms,
        query,
        recentDays,
        service,
        userId: user.id,
      });

      return jsonResponse({
        query,
        avatarId: avatar.id,
        results: sortRowsByRecentPopularity(pageResponse.results),
        providers: sortProviderStatuses(pageResponse.providers, requestedPlatforms),
        nextPageTokens: pageResponse.nextPageTokens,
      });
    }

    const cachedResults = await loadCachedResults(
      service,
      user.id,
      avatar.id,
      query,
      requestedPlatforms,
      limit,
    );

    const resultsByPlatform = new Map<Platform, Record<string, unknown>[]>();
    for (const platform of requestedPlatforms) {
      resultsByPlatform.set(platform, cachedResults.filter((row) => row.platform === platform));
    }

    const providerStatuses: ProviderStatus[] = [];
    const nextPageTokens: Partial<Record<Platform, string>> = {};
    const missingPlatforms = requestedPlatforms.filter((platform) =>
      (resultsByPlatform.get(platform)?.length ?? 0) < limit
    );

    await Promise.all(missingPlatforms.map(async (platform) => {
      try {
        const providerResult = await fetchProviderResults(platform, query, limit, undefined, {
          order,
          recentDays,
        });
        if (providerResult.results.length > 0) {
          await upsertResults(service, user.id, avatar.id, query, providerResult.results);
        }
        if (providerResult.nextPageToken) {
          nextPageTokens[platform] = providerResult.nextPageToken;
        }
        providerStatuses.push({
          platform,
          status: platform === "instagram" ? "unavailable" : "ok",
          count: providerResult.results.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown provider error";
        providerStatuses.push({
          platform,
          status: isUnavailableProviderError(platform, message) ? "unavailable" : "error",
          count: 0,
          error: normalizeProviderError(platform, message),
        });
      }
    }));

    for (const platform of requestedPlatforms) {
      if (!missingPlatforms.includes(platform)) {
        providerStatuses.push({
          platform,
          status: "cached",
          count: resultsByPlatform.get(platform)?.length ?? 0,
        });
      }
    }

    const freshResults = await loadCachedResults(
      service,
      user.id,
      avatar.id,
      query,
      requestedPlatforms,
      limit,
    );

    return jsonResponse({
      query,
      avatarId: avatar.id,
      results: sortRowsByRecentPopularity(freshResults),
      providers: sortProviderStatuses(providerStatuses, requestedPlatforms),
      nextPageTokens,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

async function fetchAndStorePageResults({
  avatarId,
  limit,
  order,
  pageTokens,
  platforms,
  query,
  recentDays,
  service,
  userId,
}: {
  avatarId: string;
  limit: number;
  order: "relevance" | "date" | "viewCount";
  pageTokens: Partial<Record<Platform, string>>;
  platforms: Platform[];
  query: string;
  recentDays: number | null;
  service: ReturnType<typeof createServiceClient>;
  userId: string;
}) {
  const providers: ProviderStatus[] = [];
  const nextPageTokens: Partial<Record<Platform, string>> = {};
  const resultUrls: string[] = [];

  await Promise.all(platforms.map(async (platform) => {
    const pageToken = pageTokens[platform];
    if (!pageToken) return;

    try {
      const providerResult = await fetchProviderResults(platform, query, limit, pageToken, {
        order,
        recentDays,
      });
      if (providerResult.results.length > 0) {
        await upsertResults(service, userId, avatarId, query, providerResult.results);
        resultUrls.push(...providerResult.results.map((result) => result.resultUrl));
      }
      if (providerResult.nextPageToken) {
        nextPageTokens[platform] = providerResult.nextPageToken;
      }
      providers.push({
        platform,
        status: "ok",
        count: providerResult.results.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown provider error";
      providers.push({
        platform,
        status: isUnavailableProviderError(platform, message) ? "unavailable" : "error",
        count: 0,
        error: normalizeProviderError(platform, message),
      });
    }
  }));

  const results = resultUrls.length > 0
    ? await loadResultsByUrl(service, userId, avatarId, query, resultUrls)
    : [];

  return { results, providers, nextPageTokens };
}

async function loadCachedResults(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  avatarId: string,
  query: string,
  platforms: Platform[],
  limit: number,
) {
  const { data, error } = await service
    .from("content_search_results")
    .select("*")
    .eq("user_id", userId)
    .eq("avatar_id", avatarId)
    .eq("query", query)
    .in("platform", platforms)
    .gt("expires_at", new Date().toISOString())
    .order("searched_at", { ascending: false })
    .limit(limit * platforms.length);

  if (error) throw error;

  const counts = new Map<Platform, number>();
  return (data ?? []).filter((row) => {
    const platform = row.platform as Platform;
    const count = counts.get(platform) ?? 0;
    if (count >= limit) return false;
    counts.set(platform, count + 1);
    return true;
  });
}

async function upsertResults(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  avatarId: string,
  query: string,
  results: NormalizedResult[],
) {
  const rows = results.map((result) => ({
    user_id: userId,
    avatar_id: avatarId,
    query,
    platform: result.platform,
    result_url: result.resultUrl,
    external_id: result.externalId,
    title: result.title,
    thumbnail_url: result.thumbnailUrl,
    duration_s: nullableInteger(result.durationS),
    view_count: nullableInteger(result.viewCount),
    like_count: nullableInteger(result.likeCount),
    author_username: result.authorUsername,
    published_at: result.publishedAt,
    raw: result.raw,
    searched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }));

  const { error } = await service
    .from("content_search_results")
    .upsert(rows, { onConflict: "user_id,avatar_id,query,platform,result_url" });
  if (error) throw error;
}

async function loadResultsByUrl(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  avatarId: string,
  query: string,
  resultUrls: string[],
) {
  const { data, error } = await service
    .from("content_search_results")
    .select("*")
    .eq("user_id", userId)
    .eq("avatar_id", avatarId)
    .eq("query", query)
    .in("result_url", resultUrls);

  if (error) throw error;
  const byUrl = new Map((data ?? []).map((row) => [row.result_url, row]));
  return resultUrls.flatMap((url) => {
    const row = byUrl.get(url);
    return row ? [row] : [];
  });
}

function sortRowsByRecentPopularity<T extends Record<string, unknown>>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const leftPublished = timestampMs(left.published_at);
    const rightPublished = timestampMs(right.published_at);
    if (leftPublished !== rightPublished) return rightPublished - leftPublished;
    return numberValue(right.view_count) - numberValue(left.view_count);
  });
}

function timestampMs(value: unknown) {
  if (typeof value !== "string") return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function fetchProviderResults(
  platform: Platform,
  query: string,
  limit: number,
  pageToken?: string,
  options: {
    order: "relevance" | "date" | "viewCount";
    recentDays: number | null;
  } = { order: "relevance", recentDays: null },
): Promise<ProviderResult> {
  if (platform === "youtube") return fetchYouTubeResults(query, limit, pageToken, options);
  if (platform === "tiktok") return fetchTikTokResults(query, limit);
  return { results: [], nextPageToken: null };
}

async function fetchYouTubeResults(
  query: string,
  limit: number,
  pageToken?: string,
  options: {
    order: "relevance" | "date" | "viewCount";
    recentDays: number | null;
  } = { order: "relevance", recentDays: null },
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

async function fetchTikTokResults(query: string, limit: number): Promise<ProviderResult> {
  const apifyToken = Deno.env.get("APIFY_TOKEN");
  if (apifyToken) {
    const actorId = Deno.env.get("APIFY_TIKTOK_ACTOR_ID") ?? "clockworks/tiktok-scraper";
    const items = await runApifyActorDataset({
      actorId,
      input: buildTikTokSearchInput(query, limit),
      limit,
      token: apifyToken,
    });
    const results: NormalizedResult[] = [];
    for (const item of items) {
      const result = normalizeApifyTikTokSearchItem(item);
      if (result) results.push(result);
      if (results.length >= limit) break;
    }

    return { results, nextPageToken: null };
  }

  const workerUrl = Deno.env.get("VIDEO_WORKER_URL");
  const workerSecret = Deno.env.get("VIDEO_WORKER_SECRET");
  if (!workerUrl) {
    throw new Error("APIFY_TOKEN or VIDEO_WORKER_URL is required for TikTok search");
  }

  const response = await fetch(`${workerUrl.replace(/\/$/, "")}/search-tiktok`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {}),
    },
    body: JSON.stringify({ query, limit }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = await response.json() as { results?: WorkerTikTokResult[] };
  return {
    results: (payload.results ?? []).map((result) => ({
      platform: "tiktok",
      resultUrl: result.resultUrl,
      externalId: extractTikTokExternalId(result.resultUrl),
      title: result.title,
      thumbnailUrl: result.thumbnailUrl,
      durationS: result.durationS,
      viewCount: result.viewCount,
      likeCount: null,
      authorUsername: result.uploader,
      publishedAt: null,
      raw: result.raw,
    })),
    nextPageToken: null,
  };
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

function normalizePlatforms(value: unknown): Platform[] {
  if (!Array.isArray(value)) return supportedPlatforms;
  const platforms = value.filter((platform): platform is Platform =>
    supportedPlatforms.includes(platform as Platform)
  );
  return platforms.length > 0 ? platforms : supportedPlatforms;
}

function normalizeOrder(value: unknown): "relevance" | "date" | "viewCount" {
  return value === "date" || value === "viewCount" ? value : "relevance";
}

function normalizeRecentDays(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.min(30, Math.trunc(parsed)));
}

function normalizePageTokens(value: unknown): Partial<Record<Platform, string>> {
  if (!isRecord(value)) return {};
  const tokens: Partial<Record<Platform, string>> = {};
  for (const platform of supportedPlatforms) {
    const token = value[platform];
    if (typeof token === "string" && token.trim()) {
      tokens[platform] = token.trim();
    }
  }
  return tokens;
}

function sortProviderStatuses(statuses: ProviderStatus[], order: Platform[]) {
  return [...statuses].sort((left, right) =>
    order.indexOf(left.platform) - order.indexOf(right.platform)
  );
}

function clampLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(20, Math.trunc(parsed)));
}

function parseIsoDuration(value: unknown) {
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

function nullableInteger(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

function extractTikTokExternalId(url: string) {
  const match = url.match(/\/video\/(\d+)/);
  return match?.[1] ?? null;
}

function isUnavailableProviderError(platform: Platform, message: string) {
  if (platform === "instagram") return true;
  return platform === "tiktok" && /tiktoksearch|Unsupported url scheme/i.test(message);
}

function normalizeProviderError(platform: Platform, message: string) {
  if (platform === "instagram") return "Busca por Instagram ainda não está disponível nesta versão.";
  if (platform === "tiktok" && /tiktoksearch|Unsupported url scheme/i.test(message)) {
    return "Busca por TikTok indisponível no worker atual.";
  }
  return message;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
