import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const authorization = request.headers.get("Authorization");
    const body = await request.json();
    const clipUrls = body.clipUrls as string[];

    if (!Array.isArray(clipUrls) || clipUrls.length === 0) {
      throw new Error("clipUrls is required");
    }

    const { data: reaction, error: reactionError } = await service
      .from("reaction_videos")
      .select("id")
      .eq("id", body.reactionId)
      .eq("user_id", user.id)
      .single();
    if (reactionError || !reaction) throw new Error("Invalid reaction");

    const rows = clipUrls.map((clipUrl) => ({
      user_id: user.id,
      account_id: null,
      reaction_id: body.reactionId,
      clip_url: clipUrl,
      overlay_text: body.overlayText,
      caption: body.caption,
      scheduled_post_at: null,
    }));

    const { data: jobs, error } = await service
      .from("reel_jobs")
      .insert(rows)
      .select("id");
    if (error) throw error;

    for (const job of jobs ?? []) {
      const { error: enqueueError } = await service.rpc("enqueue_reel_job", {
        job_id: job.id,
      });
      if (enqueueError) throw enqueueError;
    }

    if ((jobs?.length ?? 0) > 0) {
      await triggerProcessor(jobs ?? [], authorization);
    }

    return jsonResponse({ count: jobs?.length ?? 0, jobs });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

async function triggerProcessor(
  jobs: Array<{ id: string }>,
  authorization: string | null,
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl || !authorization) {
    throw new Error("Missing SUPABASE_URL or authenticated request");
  }

  const responses = await Promise.all(
    jobs.map(async (job) => {
      const response = await fetch(`${supabaseUrl}/functions/v1/reel-processor`, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId: job.id }),
      });

      if (!response.ok) {
        throw new Error(`Failed to trigger reel-processor: ${await response.text()}`);
      }

      return response;
    }),
  );

  return responses;
}
