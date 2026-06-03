import { describe, expect, test } from "bun:test";

import {
  buildInstagramReelPostPayload,
  normalizeClipUrls,
  verifyZernioSignature,
} from "./job-utils";

describe("normalizeClipUrls", () => {
  test("deduplicates pasted URLs and ignores blank lines", () => {
    const result = normalizeClipUrls(`
      https://youtube.com/shorts/abc

      https://youtube.com/shorts/abc
      https://x.com/highlight
    `);

    expect(result).toEqual([
      "https://youtube.com/shorts/abc",
      "https://x.com/highlight",
    ]);
  });

  test("rejects non-http URLs", () => {
    expect(() => normalizeClipUrls("file:///tmp/video.mp4")).toThrow(
      "Only http and https clip URLs are supported",
    );
  });
});

describe("buildInstagramReelPostPayload", () => {
  test("creates an immediate Instagram Reel payload", () => {
    const payload = buildInstagramReelPostPayload({
      accountId: "acc_123",
      caption: "Gol do dia",
      mediaUrl: "https://cdn.zernio.com/reel.mp4",
      publishNow: true,
      shareToFeed: true,
    });

    expect(payload).toEqual({
      content: "Gol do dia",
      mediaItems: [{ type: "video", url: "https://cdn.zernio.com/reel.mp4" }],
      platforms: [
        {
          platform: "instagram",
          accountId: "acc_123",
          platformSpecificData: {
            contentType: "reels",
            shareToFeed: true,
          },
        },
      ],
      publishNow: true,
    });
  });

  test("creates a scheduled Instagram Reel payload", () => {
    const payload = buildInstagramReelPostPayload({
      accountId: "acc_123",
      caption: "Gol agendado",
      mediaUrl: "https://cdn.zernio.com/reel.mp4",
      scheduledFor: "2026-06-04T12:00:00.000Z",
      shareToFeed: false,
      timezone: "America/Sao_Paulo",
    });

    expect(payload.publishNow).toBeUndefined();
    expect(payload.scheduledFor).toBe("2026-06-04T12:00:00.000Z");
    expect(payload.timezone).toBe("America/Sao_Paulo");
    expect(payload.platforms[0].platformSpecificData.shareToFeed).toBe(false);
  });
});

describe("verifyZernioSignature", () => {
  test("accepts matching HMAC-SHA256 signatures", async () => {
    const body = '{"event":"post.published"}';
    const secret = "webhook-secret";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(body),
    );
    const signature = Array.from(new Uint8Array(signatureBytes))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    await expect(
      verifyZernioSignature(body, signature, secret),
    ).resolves.toBe(true);
  });

  test("rejects mismatched signatures", async () => {
    await expect(
      verifyZernioSignature("{}", "bad-signature", "webhook-secret"),
    ).resolves.toBe(false);
  });
});
