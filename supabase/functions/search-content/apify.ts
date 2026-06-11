export type TikTokSearchResult = {
  platform: "tiktok";
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

type FetchLike = typeof fetch;

export function buildTikTokSearchInput(query: string, limit: number) {
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

export async function runApifyActorDataset({
  actorId,
  input,
  limit,
  token,
  timeoutSeconds = 120,
  fetchImpl = fetch,
}: {
  actorId: string;
  input: Record<string, unknown>;
  limit: number;
  token: string;
  timeoutSeconds?: number;
  fetchImpl?: FetchLike;
}) {
  const normalizedActorId = actorId.replace("/", "~");
  const url = new URL(`https://api.apify.com/v2/actors/${normalizedActorId}/run-sync-get-dataset-items`);
  url.searchParams.set("token", token);
  url.searchParams.set("format", "json");
  url.searchParams.set("clean", "true");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("maxItems", String(limit));
  url.searchParams.set("timeout", String(timeoutSeconds));

  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = isRecord(payload) && isRecord(payload.error)
      ? firstString(payload.error.message, payload.error.type)
      : null;
    throw new Error(message ?? response.statusText);
  }

  return Array.isArray(payload) ? payload : [];
}

export function normalizeApifyTikTokSearchItem(raw: unknown): TikTokSearchResult | null {
  if (!isRecord(raw) || raw.errorCode) return null;

  const resultUrl = firstString(
    getValue(raw, "webVideoUrl"),
    getValue(raw, "submittedVideoUrl"),
    getValue(raw, "url"),
  );
  if (!resultUrl || !resultUrl.startsWith("http")) return null;

  const thumbnailUrl = firstString(
    getValue(raw, "videoMeta.coverUrl"),
    getValue(raw, "videoMeta.originalCoverUrl"),
    getValue(raw, "thumbnailUrl"),
    getValue(raw, "coverUrl"),
  );

  return {
    platform: "tiktok",
    resultUrl,
    externalId: firstString(getValue(raw, "id")) ?? extractTikTokExternalId(resultUrl),
    title: firstString(getValue(raw, "text")) ?? "Sem título",
    thumbnailUrl,
    durationS: nullableInteger(getValue(raw, "videoMeta.duration")),
    viewCount: nullableInteger(getValue(raw, "playCount")),
    likeCount: nullableInteger(getValue(raw, "diggCount")),
    authorUsername: firstString(getValue(raw, "authorMeta.name")),
    publishedAt: firstString(getValue(raw, "createTimeISO")),
    raw,
  };
}

function getValue(record: Record<string, unknown>, path: string): unknown {
  if (path in record) return record[path];
  return path.split(".").reduce<unknown>((value, key) => {
    if (!isRecord(value)) return undefined;
    return value[key];
  }, record);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function nullableInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function extractTikTokExternalId(url: string) {
  const match = url.match(/\/video\/(\d+)/);
  return match?.[1] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
