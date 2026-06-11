import { describe, expect, test } from "bun:test";

import {
  buildTikTokSearchInput,
  normalizeApifyTikTokSearchItem,
} from "./apify.ts";

describe("buildTikTokSearchInput", () => {
  test("builds the Apify TikTok search input without downloads", () => {
    expect(buildTikTokSearchInput("gol bicicleta meme", 12)).toEqual({
      search: ["gol bicicleta meme"],
      resultsPerPage: 12,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      scrapeRelatedVideos: false,
      maxProfilesPerQuery: 0,
    });
  });
});

describe("normalizeApifyTikTokSearchItem", () => {
  test("normalizes nested TikTok actor output", () => {
    const result = normalizeApifyTikTokSearchItem({
      id: "7543693751290481942",
      text: "Gol absurdo no fim",
      createTimeISO: "2026-06-10T12:00:00.000Z",
      webVideoUrl: "https://www.tiktok.com/@page/video/7543693751290481942",
      authorMeta: { name: "page" },
      videoMeta: {
        duration: 15,
        coverUrl: "https://example.com/cover.jpg",
      },
      diggCount: 123,
      playCount: 4567,
    });

    expect(result).toEqual({
      platform: "tiktok",
      resultUrl: "https://www.tiktok.com/@page/video/7543693751290481942",
      externalId: "7543693751290481942",
      title: "Gol absurdo no fim",
      thumbnailUrl: "https://example.com/cover.jpg",
      durationS: 15,
      viewCount: 4567,
      likeCount: 123,
      authorUsername: "page",
      publishedAt: "2026-06-10T12:00:00.000Z",
      raw: {
        id: "7543693751290481942",
        text: "Gol absurdo no fim",
        createTimeISO: "2026-06-10T12:00:00.000Z",
        webVideoUrl: "https://www.tiktok.com/@page/video/7543693751290481942",
        authorMeta: { name: "page" },
        videoMeta: {
          duration: 15,
          coverUrl: "https://example.com/cover.jpg",
        },
        diggCount: 123,
        playCount: 4567,
      },
    });
  });

  test("normalizes flattened TikTok actor output and skips errors", () => {
    expect(normalizeApifyTikTokSearchItem({
      id: "755",
      text: "Drible curto",
      webVideoUrl: "https://www.tiktok.com/@club/video/755",
      "authorMeta.name": "club",
      "videoMeta.duration": 9,
      "videoMeta.coverUrl": "https://example.com/flat.jpg",
      playCount: "900",
      diggCount: "30",
    })).toMatchObject({
      resultUrl: "https://www.tiktok.com/@club/video/755",
      durationS: 9,
      viewCount: 900,
      likeCount: 30,
      authorUsername: "club",
      thumbnailUrl: "https://example.com/flat.jpg",
    });

    expect(normalizeApifyTikTokSearchItem({
      errorCode: "SEARCH_QUERY_NOT_FOUND",
      error: "No videos found",
    })).toBeNull();
  });
});
