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

type AvatarWithProfile = {
  id: string;
  name?: string | null;
  zernio_profile_id?: string | null;
};

type ServiceClient = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => PromiseLike<{ error: unknown }>;
    };
  };
};

/**
 * Zernio responses vary by endpoint (some use `_id`, some `id`, some nest the
 * object under `profile`/`data`). Pull the profile id out of any of those.
 */
function extractZernioProfileId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const obj = payload as Record<string, unknown>;

  for (const key of ["_id", "id", "profileId", "profile_id"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  for (const key of ["profile", "data"]) {
    const nested = extractZernioProfileId(obj[key]);
    if (nested) return nested;
  }

  return undefined;
}

/**
 * Find an existing Zernio profile whose name embeds the given avatar id.
 * Used to recover idempotently when a profile was already created for the
 * avatar (e.g. a previous attempt that failed before persisting the id).
 */
async function findZernioProfileIdByAvatar(avatarId: string): Promise<string | undefined> {
  const res = await zernioRequest<Record<string, unknown>>("/profiles");
  let list: unknown[] = [];
  if (Array.isArray(res)) {
    list = res;
  } else {
    list =
      (res.profiles as unknown[]) ??
      (res.data as unknown[]) ??
      (res.results as unknown[]) ??
      // Fallback: first array-valued property of the response.
      (Object.values(res).find((value) => Array.isArray(value)) as unknown[]) ??
      [];
  }

  for (const item of list) {
    if (item && typeof item === "object") {
      const name = (item as Record<string, unknown>).name;
      if (typeof name === "string" && name.includes(avatarId)) {
        return extractZernioProfileId(item);
      }
    }
  }
  return undefined;
}

/**
 * Resolve the Zernio profile that isolates an avatar's social connections.
 * Returns the profile already persisted on the avatar, or creates a new
 * Zernio profile (one per avatar) and persists its id. Never falls back to a
 * shared ZERNIO_PROFILE_ID.
 *
 * The profile name embeds the avatar id (a UUID) so it is globally unique:
 * Zernio enforces unique profile names per account, and this also guarantees
 * two avatars never share a profile even if they have the same display name.
 */
export async function resolveZernioProfileForAvatar(
  service: ServiceClient,
  avatar: AvatarWithProfile,
): Promise<string> {
  if (avatar.zernio_profile_id) {
    return avatar.zernio_profile_id;
  }

  const profileName = `${avatar.name?.trim() || "Avatar"} (${avatar.id})`;

  // Recover an existing profile first (idempotent across retries).
  let profileId = await findZernioProfileIdByAvatar(avatar.id);

  if (!profileId) {
    try {
      const created = await zernioRequest<Record<string, unknown>>("/profiles", {
        body: { name: profileName },
      });
      profileId = extractZernioProfileId(created);
    } catch (error) {
      // If it already exists, fall through and look it up below.
      const message = error instanceof Error ? error.message : String(error);
      if (!/already exists/i.test(message)) throw error;
    }

    // Create response may not echo the id (varies by endpoint) — re-list.
    if (!profileId) {
      profileId = await findZernioProfileIdByAvatar(avatar.id);
    }
  }

  if (!profileId) {
    throw new Error("Could not resolve a Zernio profile for this avatar");
  }

  const { error } = await service
    .from("avatars")
    .update({ zernio_profile_id: profileId })
    .eq("id", avatar.id);
  if (error) {
    throw error instanceof Error ? error : new Error("Failed to persist Zernio profile id");
  }

  avatar.zernio_profile_id = profileId;
  return profileId;
}

export type ZernioPresignResponse = {
  uploadUrl: string;
  publicUrl: string;
  expires?: string;
};

export async function uploadVideoToZernio(fileName: string, bytes: ArrayBuffer) {
  // Field names per Zernio docs: `filename` + `contentType`.
  const presign = await zernioRequest<ZernioPresignResponse>("/media/presign", {
    body: {
      filename: fileName,
      contentType: "video/mp4",
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
          // Strip timezone offset so Zernio interprets as wall-clock SP time
          scheduledFor: input.scheduledFor.replace(/([+-]\d{2}:\d{2}|Z)$/, ""),
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
