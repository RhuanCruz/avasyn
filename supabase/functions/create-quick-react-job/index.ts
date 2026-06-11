import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const authorization = request.headers.get("Authorization");
    const body = await request.json();
    const sourceVideoId = String(body.sourceVideoId ?? "").trim();
    const reactionId = String(body.reactionId ?? "").trim();
    const overlayText = normalizeOverlay(String(body.overlayText ?? "Olha isso"));
    const caption = normalizeCaption(String(body.caption ?? "React novo no ar."));

    if (!sourceVideoId) throw new Error("sourceVideoId is required");
    if (!reactionId) throw new Error("reactionId is required");

    const service = createServiceClient();
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);

    const { data: reaction, error: reactionError } = await service
      .from("reaction_videos")
      .select("id")
      .eq("user_id", user.id)
      .eq("avatar_id", avatar.id)
      .eq("id", reactionId)
      .single();

    if (reactionError || !reaction) {
      throw new Error("Invalid reaction");
    }

    const { data: sourceVideo, error: sourceVideoError } = await service
      .from("source_videos")
      .select("id")
      .eq("user_id", user.id)
      .eq("avatar_id", avatar.id)
      .eq("id", sourceVideoId)
      .single();

    if (sourceVideoError || !sourceVideo) {
      throw new Error("Invalid source video");
    }

    const { data: job, error } = await service
      .from("reel_jobs")
      .insert({
        user_id: user.id,
        avatar_id: avatar.id,
        account_id: null,
        source_video_id: sourceVideo.id,
        reaction_id: reactionId,
        clip_url: `source-video:${sourceVideo.id}`,
        overlay_text: overlayText,
        caption,
        scheduled_post_at: null,
      })
      .select("id")
      .single();

    if (error || !job) throw error ?? new Error("Failed to create job");

    const { error: enqueueError } = await service.rpc("enqueue_reel_job", {
      job_id: job.id,
    });
    if (enqueueError) throw enqueueError;

    EdgeRuntime.waitUntil(triggerProcessor(job.id, authorization));

    return jsonResponse({ job });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function normalizeOverlay(raw: string) {
  const words = raw.trim().replace(/\s+/g, " ").split(" ").filter(Boolean).slice(0, 3);
  return words.join(" ") || "Olha isso";
}

function normalizeCaption(raw: string) {
  const caption = raw.trim().replace(/\s+/g, " ");
  return caption ? caption.slice(0, 2200) : "React novo no ar.";
}

async function triggerProcessor(jobId: string, authorization: string | null) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl || !authorization) return;

  const response = await fetch(`${supabaseUrl}/functions/v1/reel-processor`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to trigger reel-processor: ${await response.text()}`);
  }
}
