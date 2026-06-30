import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { hedraRequest } from "../_shared/hedra.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);
    const prompt = String(body.prompt ?? "").trim();
    const rawPrompt = String(body.rawPrompt ?? prompt).trim();
    const imageModelId = String(body.imageModelId ?? "").trim();
    const count = clampCount(Number(body.count ?? 3));

    if (prompt.length < 10) throw new Error("Prompt visual muito curto");
    if (!imageModelId) throw new Error("Escolha um modelo de imagem Hedra");

    const generation = await hedraRequest<Record<string, unknown>>("/generations", {
      body: {
        type: "image",
        text_prompt: prompt,
        ai_model_id: imageModelId,
        aspect_ratio: "9:16",
        resolution: String(body.resolution ?? "auto"),
        batch_size: count,
        enhance_prompt: false,
      },
    });

    const { data: imageSet, error } = await service
      .from("presenter_image_sets")
      .insert({
        user_id: user.id,
        avatar_id: avatar.id,
        status: "generating_options",
        prompt_original: rawPrompt,
        prompt_improved: prompt,
        image_model_id: imageModelId,
        provider: "hedra",
        metadata: {
          hedra_generation_id: readString(generation.id),
          batch_generation_id: readString(generation.batch_generation_id),
          batch_results: Array.isArray(generation.batch_results) ? generation.batch_results : [],
          resolution: String(body.resolution ?? "auto"),
        },
      })
      .select("*")
      .single();
    if (error || !imageSet) throw error ?? new Error("Failed to save image generation");

    await service
      .from("presenter_avatar_profiles")
      .update({
        hedra_image_model_id: imageModelId,
        visual_provider: "hedra",
        visual_status: "in_review",
        visual_prompt: prompt,
        visual_prompt_status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("avatar_id", avatar.id)
      .eq("user_id", user.id);

    return jsonResponse({ imageSet });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function clampCount(value: number) {
  if (!Number.isFinite(value)) return 3;
  return Math.min(8, Math.max(1, Math.trunc(value)));
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
