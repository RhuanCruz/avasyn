import { describe, expect, test } from "bun:test";

import { createTikTokSearchArgs, createYtDlpArgs, YTDLP_FORMAT_SORT } from "./ytdlp-options.mjs";

describe("createYtDlpArgs", () => {
  test("enables Node as the yt-dlp JavaScript runtime", () => {
    const args = createYtDlpArgs({
      clipPath: "/tmp/clip.mp4",
      clipUrl: "https://www.youtube.com/watch?v=wV0UkHS5iqk",
    });

    expect(args).toContain("--js-runtimes");
    expect(args).toContain("node:/usr/local/bin/node");
    expect(args).toContain("--remote-components");
    expect(args).toContain("ejs:github");
    expect(args).toContain("--no-playlist");
  });

  test("passes a cookies file when configured", () => {
    const args = createYtDlpArgs({
      clipPath: "/tmp/clip.mp4",
      clipUrl: "https://www.youtube.com/watch?v=wV0UkHS5iqk",
      cookiesPath: "/tmp/youtube-cookies.txt",
    });

    expect(args).toContain("--cookies");
    expect(args).toContain("/tmp/youtube-cookies.txt");
  });

  test("passes a proxy when configured", () => {
    const args = createYtDlpArgs({
      clipPath: "/tmp/clip.mp4",
      clipUrl: "https://www.youtube.com/watch?v=wV0UkHS5iqk",
      proxyUrl: "http://proxy.example:8080",
    });

    expect(args).toContain("--proxy");
    expect(args).toContain("http://proxy.example:8080");
  });
});

describe("createTikTokSearchArgs", () => {
  test("builds a flat TikTok search command with Node runtime", () => {
    const args = createTikTokSearchArgs({
      query: "gol bicicleta meme",
      limit: 12,
    });

    expect(args).toContain("--flat-playlist");
    expect(args).toContain("--dump-json");
    expect(args).toContain("--playlist-end");
    expect(args).toContain("12");
    expect(args).toContain("--js-runtimes");
    expect(args).toContain("node:/usr/local/bin/node");
    expect(args).toContain("--remote-components");
    expect(args).toContain("ejs:github");
    expect(args.at(-1)).toBe("tiktoksearch:gol bicicleta meme");
  });

  test("passes cookies and proxy for TikTok search when configured", () => {
    const args = createTikTokSearchArgs({
      query: "futebol",
      limit: 8,
      cookiesPath: "/tmp/cookies.txt",
      proxyUrl: "http://proxy.example:8080",
    });

    expect(args).toContain("--cookies");
    expect(args).toContain("/tmp/cookies.txt");
    expect(args).toContain("--proxy");
    expect(args).toContain("http://proxy.example:8080");
  });
});

// O seletor sem teto escolhia AV1 4K (244 MB medidos) para um render que sai em 720x1280.
// Isso estourava a cota do proxy e empurrava o tempo de render para perto do limite.
describe("teto de resolucao", () => {
  test("ordena por 1080p e h264", () => {
    const args = createYtDlpArgs({ clipPath: "/tmp/c.mp4", clipUrl: "https://x" });
    const sortIndex = args.indexOf("-S");

    expect(sortIndex).toBeGreaterThan(-1);
    expect(args[sortIndex + 1]).toBe("res:1080,vcodec:h264");
  });

  test("1080 e nao 720: a metade de baixo do split recorta 832 de altura", () => {
    expect(YTDLP_FORMAT_SORT).toContain("res:1080");
    expect(YTDLP_FORMAT_SORT).not.toContain("res:720");
  });

  test("prefere h264 a AV1, que decodifica devagar em CPU fraca", () => {
    expect(YTDLP_FORMAT_SORT).toContain("vcodec:h264");
  });

  test("da para sobrescrever quando preciso", () => {
    const args = createYtDlpArgs({ clipPath: "/tmp/c.mp4", clipUrl: "https://x", formatSort: "res:480" });

    expect(args[args.indexOf("-S") + 1]).toBe("res:480");
  });
});
