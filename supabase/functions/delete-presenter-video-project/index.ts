import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";

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
      .select("id,user_id,status")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();
    if (projectError || !project) throw new Error("Project not found");

    const { error } = await service
      .from("presenter_video_projects")
      .delete()
      .eq("id", project.id)
      .eq("user_id", user.id);
    if (error) throw error;

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
