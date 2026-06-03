export type InstagramReelPayload = {
  content: string;
  mediaItems: Array<{ type: "video"; url: string }>;
  platforms: Array<{
    platform: "instagram";
    accountId: string;
    platformSpecificData: {
      contentType: "reels";
      shareToFeed: boolean;
    };
  }>;
  publishNow?: boolean;
  scheduledFor?: string;
  timezone?: string;
};

type BuildInstagramReelPostPayloadInput = {
  accountId: string;
  caption: string;
  mediaUrl: string;
  publishNow?: boolean;
  scheduledFor?: string;
  shareToFeed: boolean;
  timezone?: string;
};

export function normalizeClipUrls(input: string): string[] {
  const urls = input
    .split(/\s+/)
    .map((url) => url.trim())
    .filter(Boolean);

  const uniqueUrls = Array.from(new Set(urls));

  for (const url of uniqueUrls) {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http and https clip URLs are supported");
    }
  }

  return uniqueUrls;
}

export function buildInstagramReelPostPayload(
  input: BuildInstagramReelPostPayloadInput,
): InstagramReelPayload {
  const payload: InstagramReelPayload = {
    content: input.caption,
    mediaItems: [{ type: "video", url: input.mediaUrl }],
    platforms: [
      {
        platform: "instagram",
        accountId: input.accountId,
        platformSpecificData: {
          contentType: "reels",
          shareToFeed: input.shareToFeed,
        },
      },
    ],
  };

  if (input.scheduledFor) {
    payload.scheduledFor = input.scheduledFor;
    payload.timezone = input.timezone ?? "America/Sao_Paulo";
  } else {
    payload.publishNow = input.publishNow ?? true;
  }

  return payload;
}

export async function verifyZernioSignature(
  body: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) {
    return false;
  }

  const expected = await hmacSha256Hex(body, secret);
  return timingSafeEqual(expected, signature.replace(/^sha256=/, ""));
}

async function hmacSha256Hex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }

  return diff === 0;
}
