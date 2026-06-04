import { describe, expect, test } from "bun:test";

import { getClipSource } from "./job-media.mjs";

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

  test("throws when source video metadata is missing", () => {
    expect(() =>
      getClipSource({
        source_video_id: "source-1",
        clip_url: "source-video:source-1",
        source_videos: null,
      }),
    ).toThrow("Source video not found");
  });
});
