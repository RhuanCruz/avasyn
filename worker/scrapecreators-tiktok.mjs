// Download de TikTok pela ScrapeCreators.
//
// Existe porque o yt-dlp contra o TikTok depende de proxy residencial, e quando os proxies
// morrem (cota da Webshare acaba, IPs caem) todo download de TikTok falha com timeout. A
// ScrapeCreators devolve a URL direta do MP4 no CDN do TikTok, que baixa sem proxy e sem
// cookie -- medido: 15 MB em 10s. Custa ~1 credito por video.

const ENDPOINT = "https://api.scrapecreators.com/v2/tiktok/video";

export async function fetchScrapeCreatorsTikTok({
  apiKey,
  sourceUrl,
  fetchImpl = fetch,
  timeoutMs = 45_000,
}) {
  if (!apiKey) throw new Error("SCRAPECREATORS_API_KEY is not configured");

  const url = new URL(ENDPOINT);
  url.searchParams.set("url", sourceUrl);

  const response = await fetchImpl(url, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ScrapeCreators TikTok ${response.status}: ${text.slice(0, 200)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("ScrapeCreators TikTok returned a non-JSON response");
  }

  return payload?.aweme_detail ?? null;
}

// Prefere h264 sem marca d'agua: e o que o ffmpeg do render decodifica mais rapido, e a
// resposta tambem traz bytevc1/download_addr (com marca) que nao queremos.
export function findScrapeCreatorsVideoUrl(detail) {
  const video = detail?.video;
  const candidates = [
    video?.play_addr_h264?.url_list,
    video?.play_addr?.url_list,
    video?.download_no_watermark_addr?.url_list,
    video?.bit_rate?.[0]?.play_addr?.url_list,
  ];

  for (const list of candidates) {
    const found = Array.isArray(list) ? list.find((u) => typeof u === "string" && u.startsWith("http")) : null;
    if (found) return found;
  }
  return null;
}

export function normalizeScrapeCreatorsTikTokCandidate(detail, sourceUrl) {
  const id = String(detail?.aweme_id ?? detail?.id ?? "") || null;
  const text = typeof detail?.desc === "string" && detail.desc.trim() ? detail.desc.trim() : null;
  const stats = detail?.statistics ?? {};
  const durationMs = Number(detail?.video?.duration);

  return {
    externalId: id,
    platform: "tiktok",
    sourceUrl,
    metadata: {
      id,
      title: text ?? "TikTok importado",
      description: text,
      uploader: detail?.author?.unique_id ?? detail?.author?.nickname ?? null,
      // A API devolve a duracao em milissegundos; o resto do pipeline usa segundos.
      duration: Number.isFinite(durationMs) ? Math.round(durationMs / 1000) : null,
      timestamp: Number.isFinite(Number(detail?.create_time)) ? Number(detail.create_time) : null,
      view_count: Number.isFinite(Number(stats.play_count)) ? Number(stats.play_count) : null,
      like_count: Number.isFinite(Number(stats.digg_count)) ? Number(stats.digg_count) : null,
    },
  };
}
