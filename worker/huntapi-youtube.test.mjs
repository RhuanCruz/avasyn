import { describe, expect, test } from "bun:test";

import {
  buildHuntApiJobUrl,
  buildHuntApiVideoDownloadRequest,
  findHuntApiYouTubeDownloadUrl,
  normalizeHuntApiYouTubeCandidate,
  runHuntApiYouTubeDownloader,
} from "./huntapi-youtube.mjs";

describe("buildHuntApiVideoDownloadRequest", () => {
  test("builds a GET request for HuntAPI video download", () => {
    const request = buildHuntApiVideoDownloadRequest({
      apiKey: "secret",
      endpoint: "https://api.huntapi.com/v1/video/download",
      sourceUrl: "https://www.youtube.com/shorts/FCwmB2ZlS_Y",
    });

    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe("https://api.huntapi.com/v1/video/download");
    expect(url.searchParams.get("query")).toBe("https://www.youtube.com/shorts/FCwmB2ZlS_Y");
    expect(url.searchParams.get("download_type")).toBe("audio_video");
    expect(url.searchParams.get("max_duration")).toBe("300");
    expect(url.searchParams.get("video_quality")).toBe("best");
    expect(url.searchParams.get("video_format")).toBe("mp4");
    expect(request.headers).toEqual({ "x-api-key": "secret" });
  });
});

describe("buildHuntApiJobUrl", () => {
  test("builds the jobs polling endpoint from the download endpoint", () => {
    expect(buildHuntApiJobUrl(
      "https://api.huntapi.com/v1/video/download?query=x",
      "job-1",
    )).toBe("https://api.huntapi.com/v1/jobs/job-1");
  });
});

describe("findHuntApiYouTubeDownloadUrl", () => {
  test("returns result.response from a completed job", () => {
    expect(findHuntApiYouTubeDownloadUrl({
      result: {
        response: "https://s3.huntapi.com/videos/file.mp4",
      },
    })).toBe("https://s3.huntapi.com/videos/file.mp4");
  });

  test("ignores thumbnail and original YouTube URLs", () => {
    expect(findHuntApiYouTubeDownloadUrl({
      result: {
        metadata: {
          original_url: "https://www.youtube.com/shorts/FCwmB2ZlS_Y",
          thumbnail: "https://i.ytimg.com/vi/FCwmB2ZlS_Y/sd2.jpg",
        },
      },
    })).toBeNull();
  });
});

describe("runHuntApiYouTubeDownloader", () => {
  test("creates a job, polls until completed, and returns download_url", async () => {
    const calls = [];
    const result = await runHuntApiYouTubeDownloader({
      apiKey: "secret",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.includes("/v1/video/download")) {
          return {
            ok: true,
            status: 201,
            text: async () => JSON.stringify({ job_id: "job-1" }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            id: "job-1",
            status: "CompletedJob",
            result: {
              metadata: { title: "Clip" },
              response: "https://s3.huntapi.com/videos/file.mp4",
            },
          }),
        };
      },
      sleepImpl: async () => {},
      sourceUrl: "https://www.youtube.com/shorts/FCwmB2ZlS_Y",
    });

    expect(result.download_url).toBe("https://s3.huntapi.com/videos/file.mp4");
    expect(calls).toHaveLength(2);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[1].url).toBe("https://api.huntapi.com/v1/jobs/job-1");
  });

  test("throws when the job fails", async () => {
    await expect(runHuntApiYouTubeDownloader({
      apiKey: "secret",
      fetchImpl: async (url) => {
        if (url.includes("/v1/video/download")) {
          return {
            ok: true,
            status: 201,
            text: async () => JSON.stringify({ job_id: "job-1" }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: "FailedJob", error: "blocked" }),
        };
      },
      sleepImpl: async () => {},
      sourceUrl: "https://www.youtube.com/shorts/FCwmB2ZlS_Y",
    })).rejects.toThrow("blocked");
  });
});

describe("normalizeHuntApiYouTubeCandidate", () => {
  test("maps HuntAPI completed job metadata to source_videos metadata", () => {
    expect(normalizeHuntApiYouTubeCandidate({
      result: {
        metadata: {
          title: "Neymar 4K Edit",
          thumbnail: "https://i.ytimg.com/vi/FCwmB2ZlS_Y/sd2.jpg",
          duration: 10,
        },
      },
    }, "https://www.youtube.com/shorts/FCwmB2ZlS_Y")).toMatchObject({
      externalId: "FCwmB2ZlS_Y",
      platform: "youtube",
      sourceUrl: "https://www.youtube.com/shorts/FCwmB2ZlS_Y",
      metadata: {
        id: "FCwmB2ZlS_Y",
        title: "Neymar 4K Edit",
        thumbnail: "https://i.ytimg.com/vi/FCwmB2ZlS_Y/sd2.jpg",
        duration: 10,
        provider: "huntapi",
      },
    });
  });
});
