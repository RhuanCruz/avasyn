// Cookies that actually carry a signed-in YouTube session. If any of these are
// missing or expired, yt-dlp is effectively anonymous and gets bot-checked.
//
// LOGIN_INFO is deliberately NOT here. A jar exported without it was verified to
// authenticate against youtube.com, so flagging it as missing painted a red
// warning over a working setup — a false alarm is worse than no check at all.
const YOUTUBE_AUTH_COOKIES = [
  "__Secure-1PSID",
  "__Secure-3PSID",
  "SID",
  "HSID",
  "SSID",
];

// Netscape cookies.txt: domain \t includeSubdomains \t path \t secure \t expires \t name \t value
// `#HttpOnly_` is a real cookie line; every other `#` line is a comment.
export function parseNetscapeCookies(content) {
  return String(content ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && (!line.startsWith("#") || line.startsWith("#HttpOnly_")))
    .map((line) => line.replace(/^#HttpOnly_/, "").split("\t"))
    .filter((parts) => parts.length >= 7)
    .map((parts) => ({
      domain: parts[0],
      path: parts[2],
      secure: parts[3] === "TRUE",
      // 0 means a session cookie: it has no expiry of its own.
      expiresAt: Number(parts[4]) > 0 ? Number(parts[4]) * 1000 : null,
      name: parts[5],
    }));
}

// Reports whether the jar still holds a usable YouTube session, without ever
// exposing a cookie value.
export function summarizeYoutubeCookies(content, nowMs) {
  if (!content) {
    return { present: false, total: 0, authCookies: [], missingAuthCookies: YOUTUBE_AUTH_COOKIES, expired: null, expiresAt: null };
  }

  const cookies = parseNetscapeCookies(content);
  const byName = new Map(cookies.map((cookie) => [cookie.name, cookie]));

  const authCookies = YOUTUBE_AUTH_COOKIES
    .filter((name) => byName.has(name))
    .map((name) => {
      const { expiresAt } = byName.get(name);
      return {
        name,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        expired: expiresAt ? expiresAt <= nowMs : false,
      };
    });

  const withExpiry = authCookies.filter((cookie) => cookie.expiresAt);
  const earliest = withExpiry.length > 0
    ? withExpiry.reduce((min, cookie) => (cookie.expiresAt < min.expiresAt ? cookie : min))
    : null;

  return {
    present: true,
    total: cookies.length,
    authCookies,
    missingAuthCookies: YOUTUBE_AUTH_COOKIES.filter((name) => !byName.has(name)),
    // Any expired auth cookie is enough to break the session.
    expired: authCookies.length > 0 ? authCookies.some((cookie) => cookie.expired) : null,
    expiresAt: earliest?.expiresAt ?? null,
  };
}

// `yt-dlp --list-impersonate-targets` prints a table of every target it knows
// about — including the ones it cannot actually use. When curl_cffi is missing
// every row is suffixed "(unavailable)", so counting rows blindly would report
// impersonation as working on exactly the images where TikTok is broken.
export function parseImpersonateTargets(stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headerIndex = lines.findIndex((line) => /^Client\b/i.test(line));
  const rows = headerIndex >= 0 ? lines.slice(headerIndex + 1) : lines;

  return rows.filter((line) => {
    if (/^-{3,}/.test(line)) return false;            // table rule
    if (/^\[/.test(line)) return false;               // "[info] Available impersonate targets"
    if (/^(WARNING|ERROR)\b/i.test(line)) return false;
    if (/\(unavailable\)/i.test(line)) return false;   // known target, no backend for it
    return true;
  });
}
