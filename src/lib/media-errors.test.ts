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
    test("no modo só-yt-dlp, aponta cookies e proxy em vez de vender provider", () => {
      const message =
        "All YouTube download providers failed. HuntAPI: not configured | WebAPI: not configured "
        + "| SaveNow: not configured | Apify: not configured | YouTube is bot-checking the worker.";

      const formatted = formatMediaImportError(message);

      expect(formatted).toContain("Só o yt-dlp está disponível");
      // O detalhe do yt-dlp precisa sobreviver: era ele que dizia a causa real.
      expect(formatted).toContain("bot-checking the worker");
    });

    // O provider pago que caiu é a causa acionável. Mandar atualizar cookie quando a
    // HuntAPI devolveu 502 manda a pessoa consertar o lugar errado.
    test("nomeia o provider que falhou, com o bot-check como consequência secundária", () => {
      const message =
        "All YouTube download providers failed. HuntAPI: 502 Bad Gateway | WebAPI: not configured "
        + "| SaveNow: not configured | Apify: not configured "
        + "| YouTube is bot-checking the worker. Refresh YOUTUBE_COOKIES_BASE64 with a freshly exported cookies.txt";

      const formatted = formatMediaImportError(message);

      expect(formatted).toContain("HuntAPI: 502 Bad Gateway");
      expect(formatted).toContain("bot-check");
      // Não pode virar a mensagem que manda mexer em cookie.
      expect(formatted).not.toContain("Atualize YOUTUBE_COOKIES_BASE64");
    });

    test("lista todos os providers configurados que falharam", () => {
      const message =
        "All YouTube download providers failed. HuntAPI: 500 timeout | WebAPI: 504 gateway timeout "
        + "| SaveNow: not configured | Apify: not configured | yt-dlp failed to download this YouTube video.";

      const formatted = formatMediaImportError(message);

      expect(formatted).toContain("HuntAPI: 500 timeout");
      expect(formatted).toContain("WebAPI: 504 gateway timeout");
      // Os que nem estavam ligados não são ruído acionável.
      expect(formatted).not.toContain("SaveNow");
      expect(formatted).not.toContain("Apify");
    });

    // O proxy recusando autenticação parecia "o YouTube bloqueou", e a mensagem mandava
    // conferir cookie -- que nao tinha nada a ver com a falha.
    test("407 do proxy vira instrucao sobre o proxy, nao sobre cookie", () => {
      const raw =
        "All YouTube download providers failed. HuntAPI: not configured | WebAPI: not configured "
        + "| SaveNow: not configured | Apify: not configured "
        + "| yt-dlp: ERROR: Unable to download API page: ('Unable to connect to proxy', "
        + "OSError('Tunnel connection failed: 407 Proxy Authentication Required'))";

      const formatted = formatMediaImportError(raw);

      expect(formatted).toContain("YTDLP_PROXY");
      expect(formatted).toContain("IP Authorization");
      expect(formatted).not.toContain("Atualize os cookies");
      expect(formatMediaImportError(formatted)).toBe(formatted);
    });

    test("reconhece as varias formas do erro de proxy", () => {
      for (const raw of [
        "ERROR: HTTP Error 407: Proxy Authentication Required",
        "curl: (56) CONNECT tunnel failed, response 407",
        "ProxyError('Cannot connect to proxy')",
      ]) {
        expect(formatMediaImportError(raw)).toContain("YTDLP_PROXY");
      }
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

  // Um erro chegava a passar duas vezes pelo formatador (waitForImportCompletion
  // formatava antes de lançar, e quem capturava formatava de novo). A saída da cascata
  // contém "YOUTUBE_COOKIES_BASE64", entao a segunda passada a rebaixava para a mensagem
  // genérica de cookie e escondia qual provider tinha falhado. O ponto de origem foi
  // corrigido; esta propriedade impede que qualquer chamada dupla futura volte a degradar.
  describe("é idempotente", () => {
    const RAW_MESSAGES = [
      null,
      "",
      "something entirely new",
      "WARNING: [TikTok] The extractor is attempting impersonation, but no impersonate target is available.",
      "yt-dlp cannot impersonate a browser, which the TikTok extractor requires. Install the curl-cffi extra.",
      "All YouTube download providers failed. HuntAPI: 502 Bad Gateway | WebAPI: not configured "
        + "| SaveNow: not configured | Apify: not configured "
        + "| YouTube is bot-checking the worker. Refresh YOUTUBE_COOKIES_BASE64 with a fresh cookies.txt",
      "All YouTube download providers failed. HuntAPI: not configured | WebAPI: not configured "
        + "| SaveNow: not configured | Apify: not configured | yt-dlp failed.",
      "All YouTube download providers failed. HuntAPI: 500 timeout | WebAPI: not configured "
        + "| SaveNow: not configured | Apify: not configured | yt-dlp failed to download this YouTube video.",
      "ERROR: Sign in to confirm you're not a bot",
      "TikTok says this video is private or unavailable",
      "TikTok is rate-limiting the worker.",
      "This YouTube video is larger than the worker's 300M download limit",
      "yt-dlp found no downloadable MP4 format for this TikTok video",
      "yt-dlp does not support this TikTok URL.",
      "VIDEO_WORKER_URL is not configured",
      "Apify YouTube downloader returned demo output instead of a video",
    ];

    for (const raw of RAW_MESSAGES) {
      test(`formatar duas vezes não muda: ${JSON.stringify(raw)?.slice(0, 52) ?? "null"}`, () => {
        const once = formatMediaImportError(raw);

        expect(formatMediaImportError(once)).toBe(once);
      });
    }

    test("a cascata sobrevive: nomeia o provider e não vira mensagem de cookie", () => {
      const raw =
        "All YouTube download providers failed. HuntAPI: 502 Bad Gateway | WebAPI: 504 timeout "
        + "| SaveNow: not configured | Apify: not configured | yt-dlp failed to download this YouTube video.";

      const once = formatMediaImportError(raw);
      const twice = formatMediaImportError(once);

      expect(twice).toBe(once);
      expect(twice).toContain("HuntAPI: 502 Bad Gateway");
      // O sintoma exato do bug: desabar na mensagem genérica de cookie.
      expect(twice).not.toBe(
        "O YouTube bloqueou o download. Atualize YOUTUBE_COOKIES_BASE64 no worker com cookies recém-exportados e rode novamente.",
      );
    });
  });
});
