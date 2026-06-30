import { describe, expect, test } from "bun:test";

import {
  buildWebApiYouTubeRequest,
  findWebApiYouTubeDownloadUrl,
  normalizeWebApiYouTubeCandidate,
  runWebApiYouTubeDownloader,
} from "./webapi-youtube.mjs";

describe("buildWebApiYouTubeRequest", () => {
  test("builds a POST request using x-api-key by default", () => {
    const request = buildWebApiYouTubeRequest({
      apiKey: "secret",
      endpoint: "https://api.piloterr.com/v2/youtube/video/download",
      format: "720",
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
    });

    expect(request.url).toBe("https://api.piloterr.com/v2/youtube/video/download");
    expect(request.headers).toEqual({
      "Content-Type": "application/json",
      "x-api-key": "secret",
    });
    expect(request.body).toEqual({
      format: "720",
      query: "https://www.youtube.com/watch?v=abc123",
    });
  });

  test("supports bearer and query auth modes", () => {
    expect(buildWebApiYouTubeRequest({
      apiKey: "secret",
      authMode: "bearer",
      sourceUrl: "https://youtu.be/abc123",
    }).headers.Authorization).toBe("Bearer secret");

    const queryAuth = buildWebApiYouTubeRequest({
      apiKey: "secret",
      authMode: "query",
      sourceUrl: "https://youtu.be/abc123",
    });
    expect(new URL(queryAuth.url).searchParams.get("apikey")).toBe("secret");
    expect(queryAuth.headers).toEqual({ "Content-Type": "application/json" });
  });
});

describe("findWebApiYouTubeDownloadUrl", () => {
  test("returns direct download_url fields", () => {
    expect(findWebApiYouTubeDownloadUrl({
      download_url: "https://cdn.example.test/video.mp4",
    })).toBe("https://cdn.example.test/video.mp4");
  });

  test("returns nested video URLs", () => {
    expect(findWebApiYouTubeDownloadUrl({
      data: {
        files: [
          { type: "thumbnail", url: "https://cdn.example.test/thumb.jpg" },
          { type: "video", fileUrl: "https://cdn.example.test/video" },
        ],
      },
    })).toBe("https://cdn.example.test/video");
  });

  test("ignores original YouTube URLs", () => {
    expect(findWebApiYouTubeDownloadUrl({
      url: "https://www.youtube.com/watch?v=abc123",
    })).toBeNull();
  });
});

describe("runWebApiYouTubeDownloader", () => {
  test("returns a normalized object with download_url", async () => {
    const calls = [];
    const result = await runWebApiYouTubeDownloader({
      apiKey: "secret",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: { videoUrl: "https://cdn.example.test/video.mp4" },
          }),
        };
      },
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
    });

    expect(result.download_url).toBe("https://cdn.example.test/video.mp4");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init.body)).toEqual({
      format: "720",
      query: "https://www.youtube.com/watch?v=abc123",
    });
  });
});

describe("normalizeWebApiYouTubeCandidate", () => {
  test("maps WebAPI metadata to source_videos metadata", () => {
    expect(normalizeWebApiYouTubeCandidate({
      data: {
        title: "A great clip",
        thumbnailUrl: "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
      },
    }, "https://www.youtube.com/watch?v=abc123")).toMatchObject({
      externalId: "abc123",
      platform: "youtube",
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
      metadata: {
        id: "abc123",
        title: "A great clip",
        thumbnail: "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
        provider: "webapi",
      },
    });
  });
});
