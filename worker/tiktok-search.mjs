export function parseTikTokSearchOutput(output) {
  return String(output)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean)
    .map(normalizeTikTokResult)
    .filter(Boolean);
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeTikTokResult(raw) {
  const resultUrl = firstString(raw.webpage_url, raw.original_url, raw.url);
  if (!resultUrl || !resultUrl.startsWith("http")) {
    return null;
  }

  return {
    resultUrl,
    title: firstString(raw.title, raw.fulltitle) ?? "Sem título",
    thumbnailUrl: firstString(raw.thumbnail, lastThumbnailUrl(raw.thumbnails)),
    durationS: nullableNumber(raw.duration),
    viewCount: nullableNumber(raw.view_count),
    uploader: firstString(raw.uploader, raw.channel, raw.creator),
    raw,
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function nullableNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function lastThumbnailUrl(thumbnails) {
  if (!Array.isArray(thumbnails)) {
    return null;
  }

  for (let index = thumbnails.length - 1; index >= 0; index -= 1) {
    const url = thumbnails[index]?.url;
    if (typeof url === "string" && url.trim()) {
      return url;
    }
  }

  return null;
}
