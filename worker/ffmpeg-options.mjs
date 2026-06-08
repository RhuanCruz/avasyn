export function createFfmpegArgs({
  clipPath,
  outputPath,
  overlayText,
  reactionPath,
  withDrawText,
}) {
  const stackFilter = [
    "[0:v]scale=720:448:force_original_aspect_ratio=increase,crop=720:448,setsar=1[top]",
    "[1:v]scale=720:832:force_original_aspect_ratio=increase,crop=720:832,setsar=1[bot]",
    "[top][bot]vstack=inputs=2:shortest=1[stack]",
  ].join(";");
  const filter = withDrawText
    ? `${stackFilter};[stack]drawtext=text='${escapeDrawText(
      overlayText,
    )}':fontsize=30:fontcolor=white:x=(w-text_w)/2:y=434:box=1:boxcolor=black@0.58:borderw=8[out]`
    : `${stackFilter};[stack]copy[out]`;

  return [
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    reactionPath,
    "-i",
    clipPath,
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-map",
    "1:a?",
    "-t",
    "90",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    outputPath,
  ];
}

export function escapeDrawText(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll(":", "\\:");
}
