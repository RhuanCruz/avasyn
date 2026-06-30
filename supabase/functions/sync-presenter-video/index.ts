import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";
import {
  hedraRequest,
  normalizeHedraVideoStatus,
} from "../_shared/hedra.ts";

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
    if (!project.hedra_generation_id) throw new Error("Project has no Hedra generation");

    const response = await hedraRequest<unknown>(
      `/generations/${encodeURIComponent(project.hedra_generation_id)}/status`,
      { method: "GET" },
    );
    const status = normalizeHedraVideoStatus(response);
    const { data: updatedProject, error } = await service
      .from("presenter_video_projects")
      .update({
        status: status.status,
        hedra_video_asset_id: status.assetId,
        video_url: status.videoUrl,
        thumbnail_url: status.thumbnailUrl,
        duration_s: status.durationS,
        error_message: status.errorMessage,
        render_metadata: {
          ...(project.render_metadata ?? {}),
          hedra_progress: status.progress,
          raw_status_response: response,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .select("*")
      .single();
    if (error || !updatedProject) throw error ?? new Error("Failed to sync Hedra video");

    return jsonResponse({ project: updatedProject });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
