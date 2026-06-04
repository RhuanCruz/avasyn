export function createYtDlpArgs({
  clipPath,
  clipUrl,
  cookiesPath,
  nodePath = "/usr/local/bin/node",
  proxyUrl,
}) {
  const args = [
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "--max-filesize",
    "300M",
    "--js-runtimes",
    `node:${nodePath}`,
    "--no-playlist",
  ];

  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  if (proxyUrl) {
    args.push("--proxy", proxyUrl);
  }

  args.push("-o", clipPath, clipUrl);

  return args;
}

export function createTikTokSearchArgs({
  query,
  limit,
  cookiesPath,
  nodePath = "/usr/local/bin/node",
  proxyUrl,
}) {
  const args = [
    "--flat-playlist",
    "--dump-json",
    "--playlist-end",
    String(limit),
    "--js-runtimes",
    `node:${nodePath}`,
  ];

  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  if (proxyUrl) {
    args.push("--proxy", proxyUrl);
  }

  args.push(`tiktoksearch:${query}`);

  return args;
}
