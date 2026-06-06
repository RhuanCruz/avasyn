import { describe, expect, test } from "bun:test";

import { createFfmpegArgs, escapeDrawText } from "./ffmpeg-options.mjs";

describe("createFfmpegArgs", () => {
  test("loops reaction video and ends the stack with the clip video", () => {
    const args = createFfmpegArgs({
      clipPath: "/tmp/clip.mp4",
      outputPath: "/tmp/output.mp4",
      overlayText: "Gol",
      reactionPath: "/tmp/reaction.mp4",
      withDrawText: true,
    });

    expect(args.slice(1, 5)).toEqual(["-stream_loop", "-1", "-i", "/tmp/reaction.mp4"]);
    expect(args.join(" ")).toContain("[top][bot]vstack=inputs=2:shortest=1[stack]");
  });

  test("maps audio from the clip instead of reaction", () => {
    const args = createFfmpegArgs({
      clipPath: "/tmp/clip.mp4",
      outputPath: "/tmp/output.mp4",
      overlayText: "Gol",
      reactionPath: "/tmp/reaction.mp4",
      withDrawText: false,
    });

    const mapIndexes = args
      .map((arg, index) => (arg === "-map" ? index : -1))
      .filter((index) => index >= 0);

    expect(args[mapIndexes[0] + 1]).toBe("[out]");
    expect(args[mapIndexes[1] + 1]).toBe("1:a?");
    expect(args).not.toContain("0:a?");
  });

  test("keeps the 90 second reel cap", () => {
    const args = createFfmpegArgs({
      clipPath: "/tmp/clip.mp4",
      outputPath: "/tmp/output.mp4",
      overlayText: "Gol",
      reactionPath: "/tmp/reaction.mp4",
      withDrawText: false,
    });

    expect(args).toContain("-t");
    expect(args).toContain("90");
  });
});

describe("escapeDrawText", () => {
  test("escapes characters that break drawtext", () => {
    expect(escapeDrawText("Gol: craque's \\ lance")).toBe("Gol\\: craque\\'s \\\\ lance");
  });
});
