import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";
import { hedraRequest } from "../_shared/hedra.ts";
import { validateSpokenScriptText } from "../generate-presenter-script/script-quality.ts";

const DEFAULT_HEDRA_AVATAR_MODEL_ID = "26f0fc66-152b-40ab-abed-76c43df99bc8";

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
      throw new Error("Aprove o roteiro antes de enviar para a Hedra");
    }

    const { data: profile, error: profileError } = await service
      .from("presenter_avatar_profiles")
      .select("*")
      .eq("avatar_id", project.avatar_id)
      .eq("user_id", user.id)
      .single();
    if (profileError || !profile) throw new Error("Presenter profile not found");
    if (!profile.hedra_image_asset_id) {
      throw new Error("Aprove uma imagem do avatar antes de gerar vídeo");
    }
    const voiceId = profile.hedra_voice_id ?? profile.selected_voice_id ?? profile.default_voice_id;
    if (!voiceId) {
      throw new Error("Selecione uma voz Hedra antes de gerar vídeo");
    }

    const scriptText = String(body.scriptText ?? project.script_text ?? "").trim();
    if (!scriptText) throw new Error("Roteiro vazio");
    const scriptProblems = validateSpokenScriptText(scriptText);
    if (scriptProblems.length > 0) {
      throw new Error(scriptProblems.join(" "));
    }

    const videoModelId = String(
      body.videoModelId ?? profile.hedra_video_model_id ?? DEFAULT_HEDRA_AVATAR_MODEL_ID,
    ).trim();
    const response = await hedraRequest<Record<string, unknown>>("/generations", {
      body: {
        type: "video",
        ai_model_id: videoModelId,
        start_keyframe_id: profile.hedra_image_asset_id,
        audio_generation: {
          type: "text_to_speech",
          voice_id: voiceId,
          text: scriptText,
          language: "Portuguese",
          speed: typeof body.speed === "number" ? body.speed : 1,
          stability: typeof body.stability === "number" ? body.stability : 0.5,
        },
        generated_video_inputs: {
          text_prompt: String(
            body.motionPrompt ??
              "A presenter speaking directly to camera with natural facial expression and subtle gestures.",
          ),
          aspect_ratio: "9:16",
          resolution: String(body.resolution ?? "720p"),
        },
      },
    });

    const generationId = readString(response.id);
    if (!generationId) {
      throw new Error("Hedra did not return generation id");
    }

    const { data: updatedProject, error } = await service
      .from("presenter_video_projects")
      .update({
        script_text: scriptText,
        status: "submitted",
        provider: "hedra",
        hedra_generation_id: generationId,
        hedra_video_asset_id: readString(response.asset_id),
        image_asset_id: profile.hedra_image_asset_id,
        voice_id: voiceId,
        video_model_id: videoModelId,
        render_metadata: {
          raw_submit_response: response,
          resolution: String(body.resolution ?? "720p"),
        },
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .select("*")
      .single();
    if (error || !updatedProject) throw error ?? new Error("Failed to save Hedra video");

    await service
      .from("presenter_avatar_profiles")
      .update({
        hedra_video_model_id: videoModelId,
        video_provider: "hedra",
        updated_at: new Date().toISOString(),
      })
      .eq("avatar_id", project.avatar_id)
      .eq("user_id", user.id);

    return jsonResponse({ project: updatedProject });
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
