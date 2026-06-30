import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAuthenticatedUser } from "../_shared/supabase.ts";
import { getUploadUrl, type VideoBucket } from "../_shared/storage.ts";

const ALLOWED_BUCKETS: Set<string> = new Set([
  "source-videos",
  "reaction-videos",
  "presenter-avatar-images",
]);

const ALLOWED_MIME: Set<string> = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const body = await request.json();
    const bucket = String(body.bucket ?? "");
    const filename = String(body.filename ?? "").replace(/[^a-zA-Z0-9._-]/g, "_");
    const contentType = String(body.contentType ?? "");

    if (!ALLOWED_BUCKETS.has(bucket)) {
      return jsonResponse({ error: "Invalid bucket" }, { status: 400 });
    }
    if (!ALLOWED_MIME.has(contentType)) {
      return jsonResponse({ error: "Invalid content type" }, { status: 400 });
    }

    const ext = filename.split(".").pop()?.toLowerCase() || "mp4";
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

    const uploadUrl = await getUploadUrl(bucket as VideoBucket, path, contentType);
    return jsonResponse({ path, uploadUrl });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
