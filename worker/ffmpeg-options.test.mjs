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

  test("renders reaction at 35 percent and clip at 65 percent", () => {
    const args = createFfmpegArgs({
      clipPath: "/tmp/clip.mp4",
      outputPath: "/tmp/output.mp4",
      overlayText: "Drible seco",
      reactionPath: "/tmp/reaction.mp4",
      withDrawText: true,
    });
    const filter = args[args.indexOf("-filter_complex") + 1];

    expect(filter).toContain("[0:v]split=2[reaction_bg_src][reaction_fg_src]");
    expect(filter).toContain("[reaction_bg_src]scale=720:448:force_original_aspect_ratio=increase,crop=720:448,boxblur=18:1");
    expect(filter).toContain("[reaction_fg_src]scale=720:448:force_original_aspect_ratio=decrease,format=rgba,setsar=1[reaction_fg]");
    expect(filter).toContain("[reaction_bg][reaction_fg]overlay=(W-w)*0.500:(H-h)*0.500:format=auto[top]");
    expect(filter).toContain("[1:v]scale=720:832:force_original_aspect_ratio=increase,crop=720:832");
    expect(filter).toContain("y=434");
  });

  test("uses reaction position to place the foreground inside the top split", () => {
    const args = createFfmpegArgs({
      clipPath: "/tmp/clip.mp4",
      outputPath: "/tmp/output.mp4",
      overlayText: "Olha isso",
      reactionPath: "/tmp/reaction.mp4",
      reactionPositionX: 35,
      reactionPositionY: -20,
      withDrawText: true,
    });
    const filter = args[args.indexOf("-filter_complex") + 1];

    expect(filter).toContain("[reaction_bg][reaction_fg]overlay=(W-w)*0.675:(H-h)*0.400:format=auto[top]");
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
