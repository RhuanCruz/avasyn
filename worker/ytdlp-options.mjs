// O render sai em 720x1280. Sem dizer nada, o yt-dlp pega o "melhor" formato: num vídeo
// comum isso é AV1 em 4K -- medido em 244 MB contra 84 MB do mesmo vídeo em h264 1080p.
// Além da banda (que estourou a cota do proxy), AV1 em software num host de 2 vCPU
// decodifica devagar e empurra o render para perto do timeout.
//
// 1080 e não 720: a metade de baixo do split recorta 720x832, então uma fonte 1280x720
// (altura 720 < 832) seria ampliada e perderia nitidez. Para vídeo vertical, `res` do
// yt-dlp é a menor dimensão, então 1080 pega o 1080x1920 nativo dos Shorts.
export const YTDLP_FORMAT_SORT = "res:1080,vcodec:h264";

export function createYtDlpArgs({
  clipPath,
  clipUrl,
  cookiesPath,
  formatSort = YTDLP_FORMAT_SORT,
  nodePath = "/usr/local/bin/node",
  proxyUrl,
}) {
  const args = [
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "-S",
    formatSort,
    "--merge-output-format",
    "mp4",
    "--max-filesize",
    "300M",
    "--js-runtimes",
    `node:${nodePath}`,
    "--remote-components",
    "ejs:github",
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
    "--remote-components",
    "ejs:github",
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
