import { describe, expect, test } from "bun:test";

import {
  buildSaveNowDownloadUrl,
  findSaveNowDownloadUrl,
  normalizeSaveNowYouTubeCandidate,
  runSaveNowYouTubeDownloader,
} from "./savenow-youtube.mjs";

describe("buildSaveNowDownloadUrl", () => {
  test("builds a SaveNow YouTube download request", () => {
    const url = new URL(buildSaveNowDownloadUrl({
      apiKey: "secret",
      endpoint: "https://p.savenow.to/api/v2/download",
      format: "720",
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
    }));

    expect(url.origin + url.pathname).toBe("https://p.savenow.to/api/v2/download");
    expect(url.searchParams.get("format")).toBe("720");
    expect(url.searchParams.get("url")).toBe("https://www.youtube.com/watch?v=abc123");
    expect(url.searchParams.get("apikey")).toBe("secret");
  });
});

describe("findSaveNowDownloadUrl", () => {
  test("returns the finished progress download_url", () => {
    expect(findSaveNowDownloadUrl({
      success: 1,
      progress: 1000,
      download_url: "https://logan14.savenow.to/api/v2/download/file",
    })).toBe("https://logan14.savenow.to/api/v2/download/file");
  });

  test("ignores the original YouTube URL", () => {
    expect(findSaveNowDownloadUrl({
      success: true,
      url: "https://www.youtube.com/watch?v=abc123",
    })).toBeNull();
  });
});

describe("runSaveNowYouTubeDownloader", () => {
  test("polls progress_url until a download URL is ready", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => calls.length === 1
          ? {
            success: true,
            progress_url: "https://p.savenow.to/api/progress?id=job-1",
            text: "Preparing streaming download",
          }
          : {
            success: 1,
            progress: 1000,
            download_url: "https://logan14.savenow.to/api/v2/download/file",
            text: "Finished",
          },
      };
    };

    const result = await runSaveNowYouTubeDownloader({
      apiKey: "secret",
      fetchImpl,
      maxPolls: 2,
      pollDelayMs: 0,
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
    });

    expect(result.download_url).toBe("https://logan14.savenow.to/api/v2/download/file");
    expect(calls).toHaveLength(2);
  });
});

describe("normalizeSaveNowYouTubeCandidate", () => {
  test("maps SaveNow metadata to source_videos metadata", () => {
    expect(normalizeSaveNowYouTubeCandidate({
      format: "720",
      full_format: "mp4 [720p]",
      info: {
        title: "A great clip",
        image: "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
      },
    }, "https://www.youtube.com/watch?v=abc123")).toMatchObject({
      externalId: "abc123",
      platform: "youtube",
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
      metadata: {
        id: "abc123",
        title: "A great clip",
        thumbnail: "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
        provider: "savenow",
        format: "720",
        full_format: "mp4 [720p]",
      },
    });
  });
});
