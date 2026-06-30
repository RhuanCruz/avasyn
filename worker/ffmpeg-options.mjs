export function createFfmpegArgs({
  clipPath,
  outputPath,
  overlayText,
  reactionPath,
  reactionPositionX = 0,
  reactionPositionY = 0,
  withDrawText,
}) {
  const cropX = positionToRatio(reactionPositionX);
  const cropY = positionToRatio(reactionPositionY);
  const stackFilter = [
    `[0:v]scale=720:448:force_original_aspect_ratio=increase,crop=720:448:(iw-720)*${cropX}:(ih-448)*${cropY},setsar=1[top]`,
    "[1:v]scale=720:832:force_original_aspect_ratio=increase,crop=720:832,setsar=1[bot]",
    "[top][bot]vstack=inputs=2:shortest=1[stack]",
  ].join(";");
  // Blank overlay text means "no overlay" (automations "none" mode, quick react /
  // bulk editor without overlay) — skip drawtext entirely so we don't render an
  // empty white box.
  const hasOverlayText = String(overlayText ?? "").trim().length > 0;
  const filter = withDrawText && hasOverlayText
    ? `${stackFilter};[stack]drawtext=text='${escapeDrawText(
      overlayText,
    )}':fontsize=34:fontcolor=black:x=(w-text_w)/2:y=420:box=1:boxcolor=white:boxborderw=18[out]`
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

function positionToRatio(value) {
  const numeric = Number(value);
  const clamped = Math.max(-100, Math.min(100, Number.isFinite(numeric) ? numeric : 0));
  return ((clamped + 100) / 200).toFixed(3);
}
