export function createFfmpegArgs({
  clipPath,
  outputPath,
  overlayText,
  reactionPath,
  reactionPositionX = 0,
  reactionPositionY = 0,
  withDrawText,
}) {
  const overlayX = positionToOverlayRatio(reactionPositionX);
  const overlayY = positionToOverlayRatio(reactionPositionY);
  const stackFilter = [
    "[0:v]split=2[reaction_bg_src][reaction_fg_src]",
    "[reaction_bg_src]scale=720:448:force_original_aspect_ratio=increase,crop=720:448,boxblur=18:1,setsar=1[reaction_bg]",
    "[reaction_fg_src]scale=720:448:force_original_aspect_ratio=decrease,format=rgba,setsar=1[reaction_fg]",
    `[reaction_bg][reaction_fg]overlay=(W-w)*${overlayX}:(H-h)*${overlayY}:format=auto[top]`,
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

function positionToOverlayRatio(value) {
  const numeric = Number(value);
  const clamped = Math.max(-100, Math.min(100, Number.isFinite(numeric) ? numeric : 0));
  return ((clamped + 100) / 200).toFixed(3);
}
