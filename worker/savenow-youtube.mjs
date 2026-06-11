const defaultEndpoint = "https://p.savenow.to/api/v2/download";

export function buildSaveNowDownloadUrl({
  apiKey,
  endpoint = defaultEndpoint,
  format = "720",
  sourceUrl,
}) {
  const url = new URL(endpoint);
  url.searchParams.set("format", format);
  url.searchParams.set("url", sourceUrl);
  url.searchParams.set("apikey", apiKey);
  return url.toString();
}

export async function runSaveNowYouTubeDownloader({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  format = "720",
  maxPolls = 60,
  pollDelayMs = 2000,
  sourceUrl,
}) {
  if (!apiKey) {
    throw new Error("SAVENOW_API_KEY is not configured");
  }

  const initial = await fetchJson(fetchImpl, buildSaveNowDownloadUrl({
    apiKey,
    endpoint,
    format,
    sourceUrl,
  }));

  assertSaveNowSuccess(initial);

  let current = initial;
  let downloadUrl = findSaveNowDownloadUrl(current);
  const progressUrl = stringOrNull(current?.progress_url ?? current?.progressUrl);

  for (let attempt = 0; !downloadUrl && progressUrl && attempt < maxPolls; attempt += 1) {
    await sleep(pollDelayMs);
    current = await fetchJson(fetchImpl, progressUrl);
    assertSaveNowSuccess(current, { allowPending: true });
    downloadUrl = findSaveNowDownloadUrl(current);
  }

  if (!downloadUrl) {
    const progress = current?.progress ? ` progress=${current.progress}` : "";
    const text = current?.text ? ` text=${current.text}` : "";
    throw new Error(`SaveNow did not return a downloadable YouTube video URL.${progress}${text}`);
  }

  return { ...current, download_url: downloadUrl };
}

export function findSaveNowDownloadUrl(raw) {
  if (!raw || typeof raw !== "object") return null;

  const direct = stringOrNull(
    raw.download_url
      ?? raw.downloadUrl
      ?? raw.file_url
      ?? raw.fileUrl
      ?? raw.link
      ?? raw.url,
  );
  if (isDownloadableUrl(direct)) return direct;

  for (const value of Object.values(raw)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = findSaveNowDownloadUrl(item);
        if (nested) return nested;
      }
    } else if (value && typeof value === "object") {
      const nested = findSaveNowDownloadUrl(value);
      if (nested) return nested;
    }
  }

  return null;
}

export function normalizeSaveNowYouTubeCandidate(raw, sourceUrl) {
  const videoId = extractYouTubeId(sourceUrl);
  const info = raw?.info && typeof raw.info === "object" ? raw.info : {};
  const title = stringOrNull(raw?.title ?? info.title) ?? (videoId ? `YouTube ${videoId}` : "YouTube video");
  const thumbnail = stringOrNull(raw?.thumbnail_url ?? raw?.thumbnailUrl ?? info.image);

  return {
    externalId: videoId ?? sourceUrl,
    platform: "youtube",
    sourceUrl,
    metadata: {
      id: videoId,
      title,
      thumbnail,
      format: raw?.format ?? null,
      full_format: raw?.full_format ?? null,
      provider: "savenow",
      ...copyObject(raw),
    },
  };
}

function assertSaveNowSuccess(raw, { allowPending = false } = {}) {
  if (!raw || typeof raw !== "object") {
    throw new Error("SaveNow returned an empty response");
  }

  const success = raw.success;
  if (allowPending && success === 0 && isSaveNowPending(raw)) {
    return;
  }

  if (success === false || success === 0) {
    throw new Error(raw.message ?? raw.error ?? "SaveNow failed to download YouTube video");
  }

  if (raw.errors && typeof raw.errors === "object") {
    const message = Object.entries(raw.errors)
      .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(", ") : String(errors)}`)
      .join("; ");
    throw new Error(raw.message ? `${raw.message} ${message}` : message);
  }
}

function isSaveNowPending(raw) {
  const progress = Number(raw.progress);
  if (Number.isFinite(progress) && progress >= 0 && progress < 1000) return true;

  const text = typeof raw.text === "string" ? raw.text.toLowerCase() : "";
  return text.includes("preparing") || text.includes("processing") || text.includes("download");
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`SaveNow request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function isDownloadableUrl(value) {
  if (!value || typeof value !== "string") return false;
  if (!/^https?:\/\//i.test(value)) return false;
  return !/youtube\.com|youtu\.be/i.test(value);
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
