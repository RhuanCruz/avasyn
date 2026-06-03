export function createYtDlpArgs({
  clipPath,
  clipUrl,
  cookiesPath,
  nodePath = "/usr/local/bin/node",
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

  args.push("-o", clipPath, clipUrl);

  return args;
}
