import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import {
  extractHeyGenVideoStatus,
  heygenRequest,
} from "../_shared/heygen.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const service = createServiceClient();
    const payload = await request.json();
    const projectId = readString(payload.callback_id ?? payload.callbackId);
    const videoId = readString(payload.video_id ?? payload.videoId ?? payload.data?.video_id ?? payload.data?.id);
    if (!projectId && !videoId) {
      throw new Error("Webhook missing callback_id or video_id");
    }

    const query = service
      .from("presenter_video_projects")
      .select("*")
      .limit(1);
    const { data: projects, error: projectError } = projectId
      ? await query.eq("id", projectId)
      : await query.eq("heygen_video_id", videoId);
    if (projectError) throw projectError;

    const project = projects?.[0];
    if (!project) {
      throw new Error("Presenter video project not found");
    }
    if (!project?.heygen_video_id && !videoId) {
      throw new Error("Project has no HeyGen video");
    }

    const response = await heygenRequest<unknown>(
      `/v3/videos/${encodeURIComponent(project?.heygen_video_id ?? videoId)}`,
      { method: "GET" },
    );
    const status = extractHeyGenVideoStatus(response);
    const { error } = await service
      .from("presenter_video_projects")
      .update({
        status: status.status,
        heygen_video_id: status.videoId,
        video_url: status.videoUrl,
        thumbnail_url: status.thumbnailUrl,
        duration_s: status.durationS,
        error_message: status.errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id);
    if (error) throw error;

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
