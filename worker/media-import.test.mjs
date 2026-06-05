import assert from "node:assert/strict";
import test from "node:test";

import {
  createGalleryDlArgs,
  detectPlatform,
  normalizeInstagramUsername,
  sanitizeExternalId,
} from "./media-import.mjs";

test("creates gallery-dl args for recent Instagram reels", () => {
  assert.deepEqual(
    createGalleryDlArgs({
      cookiesPath: "/tmp/cookies.txt",
      destination: "/tmp/out",
      limit: 7,
      username: "@Example.User",
    }),
    [
      "--cookies", "/tmp/cookies.txt",
      "--range", "1-7",
      "--sleep", "2",
      "--write-metadata",
      "--filter", "extension in ('mp4', 'mov', 'webm')",
      "--directory", "/tmp/out",
      "https://www.instagram.com/example.user/reels/",
    ],
  );
});

test("normalizes usernames and external ids", () => {
  assert.equal(normalizeInstagramUsername("@Example.User"), "example.user");
  assert.equal(sanitizeExternalId("abc/123:?"), "abc-123");
});

test("detects supported source platforms", () => {
  assert.equal(detectPlatform("https://instagram.com/reel/abc"), "instagram");
  assert.equal(detectPlatform("https://youtu.be/abc"), "youtube");
  assert.equal(detectPlatform("https://www.tiktok.com/@a/video/1"), "tiktok");
  assert.equal(detectPlatform("https://cdn.example.com/a.mp4"), "direct");
});
