export function normalizeInstagramUsername(value) {
  return String(value).trim().replace(/^@/, "").toLowerCase();
}

export function createGalleryDlArgs({
  cookiesPath,
  destination,
  delaySeconds = 2,
  limit,
  username,
}) {
  const args = [];
  if (cookiesPath) args.push("--cookies", cookiesPath);
  args.push(
    "--range",
    `1-${limit}`,
    "--sleep",
    String(delaySeconds),
    "--write-metadata",
    "--filter",
    "extension in ('mp4', 'mov', 'webm')",
    "--directory",
    destination,
    `https://www.instagram.com/${normalizeInstagramUsername(username)}/reels/`,
  );
  return args;
}

export function detectPlatform(value) {
  const hostname = new URL(value).hostname.toLowerCase();
  if (hostname.includes("instagram.com")) return "instagram";
  if (hostname.includes("tiktok.com")) return "tiktok";
  if (hostname.includes("youtube.com") || hostname === "youtu.be") return "youtube";
  return "direct";
}

export function sanitizeExternalId(value) {
  return String(value)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
