import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAuthenticatedUser } from "../_shared/supabase.ts";
import { getBatchSignedUrls, type VideoBucket } from "../_shared/storage.ts";

const ALLOWED_BUCKETS: Set<string> = new Set([
  "generated-reels",
  "source-videos",
  "reaction-videos",
  "source-thumbnails",
]);

const TTL_SECONDS = 60 * 60 * 2; // 2h — matches frontend SIGN_TTL_SECONDS

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const body = await request.json();
    const bucket = String(body.bucket ?? "");
    const paths: string[] = Array.isArray(body.paths) ? body.paths.map(String) : [];

    if (!ALLOWED_BUCKETS.has(bucket)) {
      return jsonResponse({ error: "Invalid bucket" }, { status: 400 });
    }
    if (paths.length === 0 || paths.length > 200) {
      return jsonResponse({ error: "paths must have 1–200 entries" }, { status: 400 });
    }

    // Each path must be owned by the requesting user.
    const prefix = `${user.id}/`;
    for (const path of paths) {
      if (!path.startsWith(prefix)) {
        return jsonResponse({ error: "Forbidden" }, { status: 403 });
      }
    }

    const results = await getBatchSignedUrls(bucket as VideoBucket, paths, TTL_SECONDS);
    return jsonResponse(results);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
