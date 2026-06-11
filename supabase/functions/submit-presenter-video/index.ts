import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";
import { heygenRequest } from "../_shared/heygen.ts";
import { validateSpokenScriptText } from "../generate-presenter-script/script-quality.ts";

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
    if (!["script_pending_review", "ready_for_video"].includes(project.status)) {
      throw new Error("Aprove o roteiro antes de enviar para a HeyGen");
    }

    const { data: profile, error: profileError } = await service
      .from("presenter_avatar_profiles")
      .select("*")
      .eq("avatar_id", project.avatar_id)
      .eq("user_id", user.id)
      .single();
    if (profileError || !profile) throw new Error("Presenter profile not found");
    if (!profile.heygen_avatar_id) {
      throw new Error("Crie o avatar HeyGen antes de gerar vídeo");
    }

    const scriptText = String(body.scriptText ?? project.script_text ?? "").trim();
    if (!scriptText) throw new Error("Roteiro vazio");
    const scriptProblems = validateSpokenScriptText(scriptText);
    if (scriptProblems.length > 0) {
      throw new Error(scriptProblems.join(" "));
    }

    const voiceId = profile.selected_voice_id ?? profile.default_voice_id;
    const callbackUrl = Deno.env.get("HEYGEN_WEBHOOK_URL");
    const response = await heygenRequest<{
      data?: { video_id?: string; status?: string; output_format?: string };
    }>("/v3/videos", {
      idempotencyKey: `${project.id}:presenter-video`,
      body: {
        type: "avatar",
        avatar_id: profile.heygen_avatar_id,
        title: project.topic,
        aspect_ratio: "9:16",
        output_format: "mp4",
        script: scriptText,
        ...(voiceId ? { voice_id: voiceId } : {}),
        voice_settings: {
          locale: "pt-BR",
          speed: 1,
          pitch: 0,
          volume: 1,
        },
        caption: { file_format: "srt" },
        motion_prompt: "Natural presenter gestures, calm energy, direct camera delivery.",
        ...(callbackUrl ? { callback_url: callbackUrl, callback_id: project.id } : {}),
      },
    });

    const videoId = response.data?.video_id;
    if (!videoId) {
      throw new Error("HeyGen did not return video_id");
    }

    const { data: updatedProject, error } = await service
      .from("presenter_video_projects")
      .update({
        script_text: scriptText,
        status: response.data?.status === "completed" ? "completed" : "submitted",
        heygen_video_id: videoId,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .select("*")
      .single();
    if (error || !updatedProject) throw error ?? new Error("Failed to save HeyGen video");

    return jsonResponse({ project: updatedProject });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
