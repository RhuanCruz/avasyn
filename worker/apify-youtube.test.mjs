import { describe, expect, test } from "bun:test";

import {
  buildYouTubeDownloadInput,
  findApifyYouTubeDownloadUrl,
  isApifyYouTubeDemoResult,
  normalizeApifyYouTubeCandidate,
} from "./apify-youtube.mjs";

describe("buildYouTubeDownloadInput", () => {
  test("builds an Apify YouTube downloader input for Shorts URLs", () => {
    expect(buildYouTubeDownloadInput("https://www.youtube.com/shorts/abc123", "720")).toEqual({
      startUrls: ["https://www.youtube.com/shorts/abc123"],
      videoIds: ["abc123"],
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

  test("returns alternate actor output URL fields", () => {
    expect(findApifyYouTubeDownloadUrl({
      status: "succeeded",
      output: { downloadUrl: "https://api.apify.com/v2/key-value-stores/x/records/video" },
    })).toBe("https://api.apify.com/v2/key-value-stores/x/records/video");
  });

  test("returns nested downloadable video URL fields", () => {
    expect(findApifyYouTubeDownloadUrl({
      status: "succeeded",
      files: [
        { type: "metadata", url: "https://www.youtube.com/watch?v=abc123" },
        { type: "video", fileUrl: "https://example-cdn.test/video.mp4?token=abc" },
      ],
    })).toBe("https://example-cdn.test/video.mp4?token=abc");
  });

  test("does not return the original YouTube URL as a downloadable URL", () => {
    expect(findApifyYouTubeDownloadUrl({
      status: "succeeded",
      url: "https://www.youtube.com/watch?v=abc123",
    })).toBeNull();
  });

  test("returns null when the actor item failed", () => {
    expect(findApifyYouTubeDownloadUrl({
      status: "failed",
      output: { url: "https://example.com/video.mp4" },
      error: "Download failed",
    })).toBeNull();
  });

  test("returns null for demo actor output", () => {
    expect(findApifyYouTubeDownloadUrl({ demo: true })).toBeNull();
  });
});

describe("isApifyYouTubeDemoResult", () => {
  test("detects demo-only output", () => {
    expect(isApifyYouTubeDemoResult({ demo: true })).toBe(true);
    expect(isApifyYouTubeDemoResult({ demo: "sample output" })).toBe(true);
  });

  test("does not treat normal actor output as demo", () => {
    expect(isApifyYouTubeDemoResult({
      status: "succeeded",
      output: { url: "https://api.apify.com/v2/key-value-stores/x/records/video.mp4" },
    })).toBe(false);
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
