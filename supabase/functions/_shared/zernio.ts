const ZERNIO_BASE_URL = "https://zernio.com/api/v1";

type ZernioRequestOptions = {
  body?: unknown;
  method?: string;
  requestId?: string;
};

export async function zernioRequest<T>(
  path: string,
  options: ZernioRequestOptions = {},
): Promise<T> {
  const apiKey = Deno.env.get("ZERNIO_API_KEY");
  if (!apiKey) {
    throw new Error("Missing ZERNIO_API_KEY");
  }

  const response = await fetch(`${ZERNIO_BASE_URL}${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.requestId ? { "x-request-id": options.requestId } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Zernio ${response.status}: ${message}`);
  }

  return (await response.json()) as T;
}

export type ZernioPresignResponse = {
  uploadUrl: string;
  publicUrl: string;
  expires?: string;
};

export async function uploadVideoToZernio(fileName: string, bytes: ArrayBuffer) {
  const presign = await zernioRequest<ZernioPresignResponse>("/media/presign", {
    body: {
      fileName,
      fileType: "video/mp4",
    },
  });

  const upload = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: bytes,
  });

  if (!upload.ok) {
    throw new Error(`Zernio media upload failed: ${upload.status}`);
  }

  return presign.publicUrl;
}

export function buildInstagramReelPayload(input: {
  accountId: string;
  caption: string;
  mediaUrl: string;
  publishNow: boolean;
  scheduledFor?: string | null;
  shareToFeed: boolean;
}) {
  return {
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
    ...(input.scheduledFor
      ? {
          scheduledFor: input.scheduledFor,
          timezone: "America/Sao_Paulo",
        }
      : { publishNow: input.publishNow }),
  };
}

export async function verifyZernioWebhookSignature(
  body: string,
  signature: string | null,
) {
  const secret = Deno.env.get("ZERNIO_WEBHOOK_SECRET");
  if (!secret || !signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const actual = signature.replace(/^sha256=/, "");

  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return diff === 0;
}
