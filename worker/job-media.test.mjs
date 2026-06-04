import { describe, expect, test } from "bun:test";

import { getClipSource, getSourceVideoIdFromClipUrl } from "./job-media.mjs";

describe("getClipSource", () => {
  test("uses source video storage when the job has source_video_id", () => {
    expect(
      getClipSource({
        source_video_id: "source-1",
        clip_url: "source-video:source-1",
        source_videos: { storage_path: "user/source.mp4" },
      }),
    ).toEqual({ type: "storage", path: "user/source.mp4" });
  });

  test("falls back to external URL when the job has no source_video_id", () => {
    expect(
      getClipSource({
        source_video_id: null,
        clip_url: "https://youtube.com/shorts/example",
        source_videos: null,
      }),
    ).toEqual({ type: "url", url: "https://youtube.com/shorts/example" });
  });

  test("uses source-video clip_url as a storage source fallback", () => {
    expect(
      getClipSource({
        source_video_id: null,
        clip_url: "source-video:source-1",
        source_videos: { storage_path: "user/source.mp4" },
      }),
    ).toEqual({ type: "storage", path: "user/source.mp4" });
  });

  test("throws when source video metadata is missing", () => {
    expect(() =>
      getClipSource({
        source_video_id: "source-1",
        clip_url: "source-video:source-1",
        source_videos: null,
      }),
    ).toThrow("Source video not found");
  });

  test("throws when source-video clip_url has no source metadata", () => {
    expect(() =>
      getClipSource({
        source_video_id: null,
        clip_url: "source-video:source-1",
        source_videos: null,
      }),
    ).toThrow("Source video not found");
  });
});

describe("getSourceVideoIdFromClipUrl", () => {
  test("extracts source video id from internal clip URL", () => {
    expect(getSourceVideoIdFromClipUrl("source-video:source-1")).toBe("source-1");
  });

  test("returns null for external URLs", () => {
    expect(getSourceVideoIdFromClipUrl("https://example.com/video.mp4")).toBeNull();
  });
});
