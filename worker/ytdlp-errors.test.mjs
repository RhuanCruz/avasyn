import { describe, expect, test } from "bun:test";

import { describeYtDlpFailure, summarizeYtDlpStderr } from "./ytdlp-errors.mjs";

const TIKTOK_IMPERSONATION_STDERR = [
  "WARNING: [TikTok] The extractor is attempting impersonation, but no impersonate target is available.",
  "If you encounter errors, then see https://github.com/yt-dlp/yt-dlp#impersonation for information on installing the required dependencies",
  "ERROR: [TikTok] 7649346135596846357: Unexpected response from webpage request; please report this issue on https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template. Confirm you are on the latest version using yt-dlp -U",
].join("\n");

describe("summarizeYtDlpStderr", () => {
  test("keeps only the ERROR lines when present", () => {
    const summary = summarizeYtDlpStderr(TIKTOK_IMPERSONATION_STDERR);

    expect(summary.startsWith("ERROR: [TikTok] 7649346135596846357")).toBe(true);
    expect(summary).not.toContain("WARNING");
  });

  test("falls back to the tail when there is no ERROR line", () => {
    expect(summarizeYtDlpStderr("first line\nsecond line\nthird line")).toBe("second line third line");
  });

  test("truncates very long output", () => {
    const summary = summarizeYtDlpStderr(`ERROR: ${"x".repeat(900)}`);

    expect(summary.length).toBeLessThanOrEqual(400);
    expect(summary.endsWith("…")).toBe(true);
  });

  test("handles empty input", () => {
    expect(summarizeYtDlpStderr("")).toBe("");
    expect(summarizeYtDlpStderr(null)).toBe("");
  });
});

describe("describeYtDlpFailure", () => {
  test("points at the curl-cffi rebuild for the TikTok impersonation failure", () => {
    const message = describeYtDlpFailure("tiktok", TIKTOK_IMPERSONATION_STDERR);

    expect(message).toContain("cannot impersonate a browser");
    expect(message).toContain("curl-cffi");
    expect(message).toContain("TikTok");
    // The raw extractor error stays attached for debugging.
    expect(message).toContain("7649346135596846357");
  });

  test("points at the cookies env var for the YouTube bot check", () => {
    const message = describeYtDlpFailure(
      "youtube",
      "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser",
    );

    expect(message).toContain("YOUTUBE_COOKIES_BASE64");
    expect(message).toContain("bot-checking");
  });

  test("does not claim a cookie problem for an unrelated failure", () => {
    const message = describeYtDlpFailure("tiktok", TIKTOK_IMPERSONATION_STDERR);

    expect(message).not.toContain("YOUTUBE_COOKIES_BASE64");
  });

  test("recognises rate limiting, private videos and unsupported URLs", () => {
    expect(describeYtDlpFailure("tiktok", "ERROR: HTTP Error 429: Too Many Requests"))
      .toContain("rate-limiting");
    expect(describeYtDlpFailure("instagram", "ERROR: Video unavailable"))
      .toContain("private or unavailable");
    expect(describeYtDlpFailure("direct", "ERROR: Unsupported URL: https://example.com/x"))
      .toContain("does not support this");
  });

  test("falls back to a generic message with the raw detail", () => {
    const message = describeYtDlpFailure("youtube", "ERROR: something exploded");

    expect(message).toContain("failed to download this YouTube video");
    expect(message).toContain("something exploded");
  });
});
