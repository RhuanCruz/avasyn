import { describe, expect, test } from "bun:test";

import {
  buildYouTubeDownloadInput,
  findApifyYouTubeDownloadUrl,
  normalizeApifyYouTubeCandidate,
} from "./apify-youtube.mjs";

describe("buildYouTubeDownloadInput", () => {
  test("builds an Apify YouTube downloader input for Shorts URLs", () => {
    expect(buildYouTubeDownloadInput("https://www.youtube.com/shorts/abc123", "720")).toEqual({
      startUrls: ["https://www.youtube.com/shorts/abc123"],
      quality: "720",
      storageType: "apify",
    });
  });
});

describe("findApifyYouTubeDownloadUrl", () => {
  test("returns the actor output URL", () => {
    expect(findApifyYouTubeDownloadUrl({
      status: "succeeded",
      output: { url: "https://api.apify.com/v2/key-value-stores/x/records/video.mp4" },
    })).toBe("https://api.apify.com/v2/key-value-stores/x/records/video.mp4");
  });

  test("returns null when the actor item failed", () => {
    expect(findApifyYouTubeDownloadUrl({
      status: "failed",
      output: { url: "https://example.com/video.mp4" },
      error: "Download failed",
    })).toBeNull();
  });
});

describe("normalizeApifyYouTubeCandidate", () => {
  test("normalizes output metadata for source_videos", () => {
    expect(normalizeApifyYouTubeCandidate({
      inputSource: "https://www.youtube.com/watch?v=abc123",
      videoId: "abc123",
      quality: "720",
      durationSeconds: 42,
      totalCost: 0.0189,
    }, "https://www.youtube.com/watch?v=abc123")).toMatchObject({
      externalId: "abc123",
      platform: "youtube",
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
      metadata: {
        id: "abc123",
        title: "YouTube abc123",
        duration: 42,
        quality: "720",
        total_cost: 0.0189,
        inputSource: "https://www.youtube.com/watch?v=abc123",
        videoId: "abc123",
        durationSeconds: 42,
        totalCost: 0.0189,
      },
    });
  });
});
