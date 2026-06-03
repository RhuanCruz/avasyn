import { describe, expect, test } from "bun:test";

import { createYtDlpArgs } from "./ytdlp-options.mjs";

describe("createYtDlpArgs", () => {
  test("enables Node as the yt-dlp JavaScript runtime", () => {
    const args = createYtDlpArgs({
      clipPath: "/tmp/clip.mp4",
      clipUrl: "https://www.youtube.com/watch?v=wV0UkHS5iqk",
    });

    expect(args).toContain("--js-runtimes");
    expect(args).toContain("node:/usr/local/bin/node");
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
});
