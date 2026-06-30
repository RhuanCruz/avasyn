import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { hedraRequest } from "../_shared/hedra.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";

// Enhances the scene's current image. Prefers Hedra's dedicated image_upscale
// (keeps identity, just raises resolution); falls back to image_to_image when
// no upscale model is available. Result is finalized by sync-scene-image.
Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const sceneId = String(body.sceneId ?? "").trim();
    if (!sceneId) throw new Error("sceneId is required");

    const { data: scene, error: sceneError } = await service
      .from("presenter_video_scenes")
      .select("*")
      .eq("id", sceneId)
      .eq("user_id", user.id)
      .single();
    if (sceneError || !scene) throw new Error("Cena não encontrada");
    if (!scene.hedra_image_asset_id) throw new Error("Gere ou envie a imagem da cena antes de melhorar");

    // Discover an upscale-capable model from the catalog.
    let upscaleModelId: string | null = null;
    try {
      const rawModels = await hedraRequest<unknown>("/models");
      const list = Array.isArray(rawModels) ? rawModels : [];
      const found = list.find((m) => {
        const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
        const t = String(o.type ?? "").toLowerCase();
        const n = String(o.name ?? "").toLowerCase();
        return t.includes("upscale") || n.includes("upscale");
      });
      if (found) upscaleModelId = readString((found as Record<string, unknown>).id);
    } catch {
      // ignore catalog errors and fall back below
    }

    let generationId: string | null = null;
    if (upscaleModelId) {
      const generation = await hedraRequest<Record<string, unknown>>("/generations", {
        body: {
          type: "image_upscale",
          ai_model_id: upscaleModelId,
          image_id: scene.hedra_image_asset_id,
          upscale_factor: 2,
        },
      });
      generationId = readString(generation.id);
    } else {
      // Fallback: image_to_image conditioned on the current image.
      const { data: profile } = await service
        .from("presenter_avatar_profiles")
        .select("hedra_image_model_id")
        .eq("avatar_id", scene.avatar_id)
        .eq("user_id", user.id)
        .maybeSingle();
      const modelId = readString(body.imageModelId) ?? readString(profile?.hedra_image_model_id);
      if (!modelId) throw new Error("Sem modelo de imagem disponível para melhorar");
      const generation = await hedraRequest<Record<string, unknown>>("/generations", {
        body: {
          type: "image_to_image",
          text_prompt: "mesma pessoa, alta resolução, nítida, bem iluminada, retrato profissional, vertical 9:16",
          ai_model_id: modelId,
          reference_image_ids: [scene.hedra_image_asset_id],
          aspect_ratio: "9:16",
          resolution: "auto",
          batch_size: 1,
          enhance_prompt: false,
        },
      });
      generationId = readString(generation.id);
    }

    if (!generationId) throw new Error("Hedra não retornou id de geração");

    const { data: updated, error } = await service
      .from("presenter_video_scenes")
      .update({
        content_status: "generating",
        image_source: "generated",
        hedra_generation_id: generationId,
        error_message: null,
        metadata: {
          ...(scene.metadata ?? {}),
          hedra_generation_id: generationId,
          upscaled: true,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", scene.id)
      .select("*")
      .single();
    if (error || !updated) throw error ?? new Error("Falha ao salvar melhoria da cena");

    return jsonResponse({ scene: updated, pending: true });
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
