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
    const sourceVideoIds = uniqueStrings(body.sourceVideoIds);
    const reactionIds = uniqueStrings(body.reactionIds);

    if (sourceVideoIds.length === 0) {
      throw new Error("sourceVideoIds is required");
    }

    if (reactionIds.length === 0) {
      throw new Error("reactionIds is required");
    }

    const totalJobs = sourceVideoIds.length * reactionIds.length;
    if (totalJobs > 100) {
      throw new Error("Bulk editor supports up to 100 jobs at a time");
    }

    const { data: sourceVideos, error: sourceError } = await service
      .from("source_videos")
      .select("id, name, storage_path")
      .eq("user_id", user.id)
      .in("id", sourceVideoIds);
    if (sourceError) throw sourceError;
    if ((sourceVideos?.length ?? 0) !== sourceVideoIds.length) {
      throw new Error("Invalid source video selection");
    }

    const { data: reactions, error: reactionError } = await service
      .from("reaction_videos")
      .select("id")
      .eq("user_id", user.id)
      .in("id", reactionIds);
    if (reactionError) throw reactionError;
    if ((reactions?.length ?? 0) !== reactionIds.length) {
      throw new Error("Invalid reaction selection");
    }

    const rows = (sourceVideos ?? []).flatMap((sourceVideo) =>
      reactionIds.map((reactionId) => ({
        user_id: user.id,
        account_id: null,
        source_video_id: sourceVideo.id,
        reaction_id: reactionId,
        clip_url: `source-video:${sourceVideo.id}`,
        overlay_text: String(body.overlayText ?? ""),
        caption: String(body.caption ?? ""),
        scheduled_post_at: null,
      })),
    );

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

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(String).filter(Boolean)));
}

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
