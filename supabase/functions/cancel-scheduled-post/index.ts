import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const jobId = String(body.jobId ?? "").trim();

    if (!jobId) throw new Error("jobId is required");

    const { data: job, error: fetchError } = await service
      .from("reel_jobs")
      .select("id, user_id, status, scheduled_post_at, account_id")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !job) throw new Error("Job not found");
    if (!job.scheduled_post_at && !job.account_id) {
      throw new Error("Job is not scheduled");
    }
    if (job.status === "posted") {
      throw new Error("Job already posted — cannot cancel");
    }

    const { error } = await service
      .from("reel_jobs")
      .update({
        account_id: null,
        scheduled_post_at: null,
        ...(job.status === "posting" ? { status: "rendered" } : {}),
      })
      .eq("id", jobId);

    if (error) throw error;

    return jsonResponse({ ok: true, previousStatus: job.status });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
