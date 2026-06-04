import { describe, expect, test } from "bun:test";

import { parseTikTokSearchOutput } from "./tiktok-search.mjs";

describe("parseTikTokSearchOutput", () => {
  test("normalizes TikTok flat-search JSON lines", () => {
    const output = [
      JSON.stringify({
        id: "7350000000000000000",
        title: "Gol bicicleta meme",
        webpage_url: "https://www.tiktok.com/@club/video/7350000000000000000",
        thumbnail: "https://example.com/thumb.jpg",
        duration: 17,
        view_count: 123456,
        uploader: "club",
      }),
      JSON.stringify({
        id: "7360000000000000000",
        title: "Outro lance",
        url: "https://www.tiktok.com/@page/video/7360000000000000000",
        thumbnails: [{ url: "https://example.com/low.jpg" }, { url: "https://example.com/high.jpg" }],
        duration: "23",
      }),
    ].join("\n");

    expect(parseTikTokSearchOutput(output)).toEqual([
      {
        resultUrl: "https://www.tiktok.com/@club/video/7350000000000000000",
        title: "Gol bicicleta meme",
        thumbnailUrl: "https://example.com/thumb.jpg",
        durationS: 17,
        viewCount: 123456,
        uploader: "club",
        raw: {
          id: "7350000000000000000",
          title: "Gol bicicleta meme",
          webpage_url: "https://www.tiktok.com/@club/video/7350000000000000000",
          thumbnail: "https://example.com/thumb.jpg",
          duration: 17,
          view_count: 123456,
          uploader: "club",
        },
      },
      {
        resultUrl: "https://www.tiktok.com/@page/video/7360000000000000000",
        title: "Outro lance",
        thumbnailUrl: "https://example.com/high.jpg",
        durationS: 23,
        viewCount: null,
        uploader: null,
        raw: {
          id: "7360000000000000000",
          title: "Outro lance",
          url: "https://www.tiktok.com/@page/video/7360000000000000000",
          thumbnails: [{ url: "https://example.com/low.jpg" }, { url: "https://example.com/high.jpg" }],
          duration: "23",
        },
      },
    ]);
  });

  test("skips invalid lines and results without usable URLs", () => {
    const output = [
      "not json",
      JSON.stringify({ title: "missing url" }),
      JSON.stringify({
        title: "ok",
        webpage_url: "https://www.tiktok.com/@page/video/7370000000000000000",
      }),
    ].join("\n");

    expect(parseTikTokSearchOutput(output)).toHaveLength(1);
    expect(parseTikTokSearchOutput(output)[0].resultUrl).toBe(
      "https://www.tiktok.com/@page/video/7370000000000000000",
    );
  });
});
