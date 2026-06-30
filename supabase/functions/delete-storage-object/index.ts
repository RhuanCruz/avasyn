import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAuthenticatedUser } from "../_shared/supabase.ts";
import { deleteBatch, type VideoBucket } from "../_shared/storage.ts";

const ALLOWED_BUCKETS: Set<string> = new Set([
  "source-videos",
  "reaction-videos",
  "source-thumbnails",
  "presenter-avatar-images",
]);

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const body = await request.json();
    const bucket = String(body.bucket ?? "");

    // Accept either a single path or an array of paths.
    const rawPaths = Array.isArray(body.paths)
      ? body.paths.map(String)
      : body.path
      ? [String(body.path)]
      : [];

    if (!ALLOWED_BUCKETS.has(bucket)) {
      return jsonResponse({ error: "Invalid bucket" }, { status: 400 });
    }
    if (rawPaths.length === 0 || rawPaths.length > 500) {
      return jsonResponse({ error: "paths must have 1–500 entries" }, { status: 400 });
    }

    const prefix = `${user.id}/`;
    for (const path of rawPaths) {
      if (!path.startsWith(prefix)) {
        return jsonResponse({ error: "Forbidden" }, { status: 403 });
      }
    }

    await deleteBatch(bucket as VideoBucket, rawPaths);
    return jsonResponse({ ok: true, deleted: rawPaths.length });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
