import { describe, expect, test } from "bun:test";

import {
  buildTikTokSearchInput,
  buildTikTokDownloadInput,
  findApifyTikTokVideoDownloadUrl,
  normalizeApifyTikTokSearchResult,
  normalizeApifyTikTokVideoCandidate,
} from "./apify-tiktok.mjs";

describe("buildTikTokSearchInput", () => {
  test("builds an Apify TikTok search input without downloads", () => {
    expect(buildTikTokSearchInput("neymar edits", 12)).toEqual({
      search: ["neymar edits"],
      resultsPerPage: 12,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      scrapeRelatedVideos: false,
      maxProfilesPerQuery: 0,
    });
  });
});

describe("buildTikTokDownloadInput", () => {
  test("builds an Apify TikTok URL input with video download enabled", () => {
    expect(buildTikTokDownloadInput("https://www.tiktok.com/@page/video/123")).toEqual({
      postURLs: ["https://www.tiktok.com/@page/video/123"],
      shouldDownloadVideos: true,
      shouldDownloadCovers: true,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
      scrapeRelatedVideos: false,
    });
  });
});

describe("normalizeApifyTikTokSearchResult", () => {
  test("maps Apify TikTok output to the worker search response shape", () => {
    expect(normalizeApifyTikTokSearchResult({
      id: "123",
      text: "Neymar edit",
      webVideoUrl: "https://www.tiktok.com/@page/video/123",
      authorMeta: { name: "page" },
      videoMeta: { duration: 14, coverUrl: "https://example.com/thumb.jpg" },
      playCount: 1200,
    })).toEqual({
      resultUrl: "https://www.tiktok.com/@page/video/123",
      title: "Neymar edit",
      thumbnailUrl: "https://example.com/thumb.jpg",
      durationS: 14,
      viewCount: 1200,
      uploader: "page",
      raw: {
        id: "123",
        text: "Neymar edit",
        webVideoUrl: "https://www.tiktok.com/@page/video/123",
        authorMeta: { name: "page" },
        videoMeta: { duration: 14, coverUrl: "https://example.com/thumb.jpg" },
        playCount: 1200,
      },
    });
  });
});

describe("findApifyTikTokVideoDownloadUrl", () => {
  test("finds a downloaded video URL from mediaUrls", () => {
    expect(findApifyTikTokVideoDownloadUrl({
      mediaUrls: [
        { type: "thumbnail", downloadLink: "https://example.com/a.jpg" },
        { type: "video", downloadLink: "https://example.com/a.mp4" },
      ],
    })).toBe("https://example.com/a.mp4");
  });

  test("falls back to TikTok link shaped as mp4", () => {
    expect(findApifyTikTokVideoDownloadUrl({
      videoMeta: {
        downloadAddr: "https://cdn.example.com/video.mp4",
      },
    })).toBe("https://cdn.example.com/video.mp4");
  });
});

describe("normalizeApifyTikTokVideoCandidate", () => {
  test("normalizes metadata from a TikTok URL actor result", () => {
    expect(normalizeApifyTikTokVideoCandidate({
      id: "123",
      text: "Lance para react",
      webVideoUrl: "https://www.tiktok.com/@page/video/123",
      authorMeta: { name: "page" },
      videoMeta: { duration: 20 },
      createTime: 1781100000,
      playCount: 1000,
      diggCount: 80,
    }, "https://www.tiktok.com/@page/video/123")).toMatchObject({
      externalId: "123",
      platform: "tiktok",
      sourceUrl: "https://www.tiktok.com/@page/video/123",
      metadata: {
        id: "123",
        title: "Lance para react",
        uploader: "page",
        duration: 20,
        timestamp: 1781100000,
        view_count: 1000,
        like_count: 80,
      },
    });
  });
});
