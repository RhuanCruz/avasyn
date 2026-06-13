import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const jobIds = Array.isArray(body.jobIds)
      ? Array.from(new Set(body.jobIds.map(String).filter(Boolean)))
      : [];

    if (jobIds.length === 0) throw new Error("jobIds is required");
    if (jobIds.length > 500) throw new Error("Too many jobs in one request");

    // Only delete jobs owned by the authenticated user.
    const { data: deleted, error } = await service
      .from("reel_jobs")
      .delete()
      .eq("user_id", user.id)
      .in("id", jobIds)
      .select("id");

    if (error) throw error;

    return jsonResponse({ deleted: deleted?.length ?? 0 });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
