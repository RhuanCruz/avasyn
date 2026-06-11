import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";
import {
  extractHeyGenVideoStatus,
  heygenRequest,
} from "../_shared/heygen.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const projectId = String(body.projectId ?? "").trim();
    if (!projectId) throw new Error("projectId is required");

    const { data: project, error: projectError } = await service
      .from("presenter_video_projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();
    if (projectError || !project) throw new Error("Project not found");
    if (!project.heygen_video_id) throw new Error("Project has no HeyGen video");

    const response = await heygenRequest<unknown>(
      `/v3/videos/${encodeURIComponent(project.heygen_video_id)}`,
      { method: "GET" },
    );
    const status = extractHeyGenVideoStatus(response);
    const { data: updatedProject, error } = await service
      .from("presenter_video_projects")
      .update({
        status: status.status,
        video_url: status.videoUrl,
        thumbnail_url: status.thumbnailUrl,
        duration_s: status.durationS,
        error_message: status.errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .select("*")
      .single();
    if (error || !updatedProject) throw error ?? new Error("Failed to sync HeyGen video");

    return jsonResponse({ project: updatedProject });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
