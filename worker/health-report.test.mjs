import { describe, expect, test } from "bun:test";

import {
  parseImpersonateTargets,
  parseNetscapeCookies,
  summarizeYoutubeCookies,
} from "./health-report.mjs";

const NOW = Date.parse("2026-08-21T00:00:00.000Z");
const FUTURE = Math.floor(Date.parse("2026-12-01T00:00:00.000Z") / 1000);
const PAST = Math.floor(Date.parse("2026-01-01T00:00:00.000Z") / 1000);

function cookieLine(name, expires, { httpOnly = false } = {}) {
  const prefix = httpOnly ? "#HttpOnly_" : "";
  return `${prefix}.youtube.com\tTRUE\t/\tTRUE\t${expires}\t${name}\tREDACTED`;
}

const JAR = [
  "# Netscape HTTP Cookie File",
  "# This is a generated file! Do not edit.",
  "",
  cookieLine("__Secure-1PSID", FUTURE, { httpOnly: true }),
  cookieLine("__Secure-3PSID", FUTURE),
  cookieLine("SID", FUTURE),
  cookieLine("HSID", FUTURE),
  cookieLine("SSID", FUTURE),
  cookieLine("LOGIN_INFO", FUTURE),
  cookieLine("YSC", 0),
].join("\n");

describe("parseNetscapeCookies", () => {
  test("parses cookie lines and keeps #HttpOnly_ entries", () => {
    const cookies = parseNetscapeCookies(JAR);

    expect(cookies).toHaveLength(7);
    expect(cookies.map((c) => c.name)).toContain("__Secure-1PSID");
    expect(cookies[0].domain).toBe(".youtube.com");
  });

  test("treats expires=0 as a session cookie", () => {
    const session = parseNetscapeCookies(JAR).find((c) => c.name === "YSC");

    expect(session.expiresAt).toBeNull();
  });

  test("ignores comments and malformed lines", () => {
    expect(parseNetscapeCookies("# just a comment\nnot\ta\tcookie")).toHaveLength(0);
    expect(parseNetscapeCookies("")).toHaveLength(0);
  });

  test("never surfaces the cookie value", () => {
    for (const cookie of parseNetscapeCookies(JAR)) {
      expect(Object.keys(cookie)).not.toContain("value");
    }
  });
});

describe("summarizeYoutubeCookies", () => {
  test("reports a healthy jar", () => {
    const summary = summarizeYoutubeCookies(JAR, NOW);

    expect(summary.present).toBe(true);
    expect(summary.total).toBe(7);
    expect(summary.expired).toBe(false);
    expect(summary.missingAuthCookies).toHaveLength(0);
    expect(summary.expiresAt).toBe("2026-12-01T00:00:00.000Z");
  });

  test("flags an expired session", () => {
    const stale = JAR.replace(cookieLine("SID", FUTURE), cookieLine("SID", PAST));
    const summary = summarizeYoutubeCookies(stale, NOW);

    expect(summary.expired).toBe(true);
    expect(summary.expiresAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("lists the auth cookies that are missing entirely", () => {
    const partial = [cookieLine("SID", FUTURE), cookieLine("HSID", FUTURE)].join("\n");
    const summary = summarizeYoutubeCookies(partial, NOW);

    expect(summary.missingAuthCookies).toContain("LOGIN_INFO");
    expect(summary.missingAuthCookies).toContain("__Secure-1PSID");
    expect(summary.expired).toBe(false);
  });

  test("reports an absent jar without throwing", () => {
    const summary = summarizeYoutubeCookies(undefined, NOW);

    expect(summary.present).toBe(false);
    expect(summary.total).toBe(0);
    expect(summary.expired).toBeNull();
  });
});

describe("parseImpersonateTargets", () => {
  test("counts real target rows", () => {
    const stdout = [
      "[info] Available impersonate targets",
      "Client        OS          Source",
      "------------- ----------- ------------",
      "chrome-110    windows-10  curl_cffi",
      "safari-17.0   macos-14    curl_cffi",
    ].join("\n");

    expect(parseImpersonateTargets(stdout)).toEqual([
      "chrome-110    windows-10  curl_cffi",
      "safari-17.0   macos-14    curl_cffi",
    ]);
  });

  // Verbatim stdout from a yt-dlp install without the curl-cffi extra: every
  // target is listed but none is usable. This is the TikTok failure mode.
  test("reports no targets when every row is marked (unavailable)", () => {
    const stdout = [
      "[info] Available impersonate targets",
      "Client    OS   Source",
      "--------------------------------------------",
      "Tor       -    curl_cffi>=0.11 (unavailable)",
      "Edge      -    curl_cffi (unavailable)",
      "Firefox   -    curl_cffi>=0.10 (unavailable)",
      "Safari    -    curl_cffi (unavailable)",
      "Chrome    -    curl_cffi (unavailable)",
    ].join("\n");

    expect(parseImpersonateTargets(stdout)).toHaveLength(0);
  });

  test("keeps only the usable rows in a mixed table", () => {
    const stdout = [
      "[info] Available impersonate targets",
      "Client    OS   Source",
      "----------------------------",
      "Chrome    -    curl_cffi",
      "Tor       -    curl_cffi>=0.11 (unavailable)",
    ].join("\n");

    expect(parseImpersonateTargets(stdout)).toEqual(["Chrome    -    curl_cffi"]);
  });

  test("ignores warning noise and empty output", () => {
    expect(parseImpersonateTargets("WARNING: Your yt-dlp version is older than 90 days!")).toHaveLength(0);
    expect(parseImpersonateTargets("[info] Available impersonate targets\nClient OS\n--- ---")).toHaveLength(0);
    expect(parseImpersonateTargets("")).toHaveLength(0);
    expect(parseImpersonateTargets(null)).toHaveLength(0);
  });
});
