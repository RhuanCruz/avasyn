export function buildYouTubeDownloadInput(url, quality = "720") {
  return {
    startUrls: [url],
    quality,
    storageType: "apify",
  };
}

export async function runApifyYouTubeDownloader({
  actorId = "epctex/youtube-video-downloader",
  fetchImpl = fetch,
  input,
  limit = 1,
  token,
  timeoutSeconds = 300,
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

export function findApifyYouTubeDownloadUrl(raw) {
  if (!raw || raw.error || raw.status === "failed") return null;
  return firstString(raw.output?.url, raw.downloadUrl, raw.url);
}

export function normalizeApifyYouTubeCandidate(raw, sourceUrl) {
  const externalId = firstString(raw?.videoId) ?? extractYouTubeExternalId(sourceUrl);
  return {
    externalId,
    platform: "youtube",
    sourceUrl: firstString(raw?.inputSource) ?? sourceUrl,
    metadata: {
      ...raw,
      id: externalId,
      title: `YouTube ${externalId ?? "importado"}`,
      duration: nullableNumber(raw?.durationSeconds),
      quality: firstString(raw?.quality),
      total_cost: nullableNumber(raw?.totalCost),
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

function extractYouTubeExternalId(url) {
  const value = String(url);
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "youtu.be") return parsed.pathname.replace("/", "") || null;
    if (parsed.pathname.startsWith("/shorts/")) {
      return parsed.pathname.split("/").filter(Boolean)[1] ?? null;
    }
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}
