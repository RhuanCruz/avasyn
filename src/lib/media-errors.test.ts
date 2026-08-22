import { describe, expect, test } from "bun:test";

import { formatMediaImportError } from "./media-errors";

describe("formatMediaImportError", () => {
  test("returns a fallback for an empty message", () => {
    expect(formatMediaImportError(null)).toBe("Falha ao importar mídia");
    expect(formatMediaImportError("")).toBe("Falha ao importar mídia");
  });

  describe("TikTok impersonation", () => {
    const WORKER_MESSAGE =
      "yt-dlp cannot impersonate a browser, which the TikTok extractor requires. "
      + "Rebuild the video worker image so yt-dlp is installed with the curl-cffi extra (yt-dlp[default,curl-cffi]). "
      + "yt-dlp: ERROR: [TikTok] 7649346135596846357: Unexpected response from webpage request";

    test("explains the worker rebuild instead of blaming cookies", () => {
      const formatted = formatMediaImportError(WORKER_MESSAGE);

      expect(formatted).toContain("finja ser um navegador");
      expect(formatted).toContain("curl-cffi");
      expect(formatted).not.toContain("YOUTUBE_COOKIES_BASE64");
    });

    test("also recognises the raw yt-dlp warning from an old worker image", () => {
      const raw =
        "WARNING: [TikTok] The extractor is attempting impersonation, but no impersonate target is available.\n"
        + "ERROR: [TikTok] 7649346135596846357: Unexpected response from webpage request";

      expect(formatMediaImportError(raw)).toContain("curl-cffi");
    });
  });

  describe("YouTube", () => {
    test("says which knob to turn when no provider is configured", () => {
      const message =
        "All YouTube download providers failed. HuntAPI: not configured | WebAPI: not configured "
        + "| SaveNow: not configured | Apify: not configured | YouTube is bot-checking the worker.";

      const formatted = formatMediaImportError(message);

      expect(formatted).toContain("Nenhum provedor de download do YouTube está configurado");
      expect(formatted).toContain("Configure uma dessas chaves");
    });

    test("points at the cookies when a configured provider failed and yt-dlp got bot-checked", () => {
      const message =
        "All YouTube download providers failed. HuntAPI: 502 Bad Gateway | WebAPI: not configured "
        + "| SaveNow: not configured | Apify: not configured "
        + "| YouTube is bot-checking the worker. Refresh YOUTUBE_COOKIES_BASE64 with a freshly exported cookies.txt";

      const formatted = formatMediaImportError(message);

      expect(formatted).toContain("YOUTUBE_COOKIES_BASE64");
      expect(formatted).toContain("bot-checkou");
    });

    test("keeps the provider details when the cause is something else", () => {
      const message =
        "All YouTube download providers failed. HuntAPI: 500 timeout | WebAPI: not configured "
        + "| SaveNow: not configured | Apify: not configured | yt-dlp failed to download this YouTube video.";

      const formatted = formatMediaImportError(message);

      expect(formatted).toContain("Nenhum provedor conseguiu baixar");
      expect(formatted).toContain("HuntAPI: 500 timeout");
    });

    test("maps a bare bot-check to the cookie fix", () => {
      expect(formatMediaImportError("ERROR: Sign in to confirm you're not a bot"))
        .toContain("YOUTUBE_COOKIES_BASE64");
    });
  });

  describe("other worker failures", () => {
    test("private or removed video", () => {
      expect(formatMediaImportError("TikTok says this video is private or unavailable"))
        .toContain("privado ou foi removido");
    });

    test("rate limiting", () => {
      expect(formatMediaImportError("TikTok is rate-limiting the worker. Retry later"))
        .toContain("limitando os downloads");
    });

    test("file too large", () => {
      expect(formatMediaImportError("This YouTube video is larger than the worker's 300M download limit"))
        .toContain("300MB");
    });

    test("stale extractor", () => {
      expect(formatMediaImportError("yt-dlp found no downloadable MP4 format for this TikTok video"))
        .toContain("Reconstrua a imagem do worker");
    });

    test("unsupported url", () => {
      expect(formatMediaImportError("yt-dlp does not support this TikTok URL."))
        .toContain("não suporta essa URL");
    });

    test("worker not deployed", () => {
      expect(formatMediaImportError("VIDEO_WORKER_URL is not configured"))
        .toContain("VIDEO_WORKER_URL");
      expect(formatMediaImportError("TikTok worker search endpoint not found. Rebuild/redeploy the video worker container with the latest code."))
        .toContain("desatualizado");
    });

    test("apify actor problems", () => {
      expect(formatMediaImportError("Apify YouTube downloader returned demo output instead of a video"))
        .toContain("actor do YouTube");
    });

    test("passes an unknown message through untouched", () => {
      expect(formatMediaImportError("something entirely new")).toBe("something entirely new");
    });
  });
});
