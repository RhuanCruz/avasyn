import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { hedraRequest } from "../_shared/hedra.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";

const STYLE_SUFFIX: Record<string, string> = {
  realista: "foto realista, alta nitidez",
  cine: "estilo cinematográfico, iluminação dramática",
  ilustra: "ilustração digital estilizada",
  "3d": "render 3D estilizado",
};

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

    const basePrompt = String(scene.improved_prompt ?? scene.prompt ?? "").trim();
    if (basePrompt.length < 6) throw new Error("Prompt da imagem muito curto");

    const { data: profile } = await service
      .from("presenter_avatar_profiles")
      .select("hedra_image_model_id, hedra_image_asset_id")
      .eq("avatar_id", scene.avatar_id)
      .eq("user_id", user.id)
      .maybeSingle();
    const imageModelId = String(body.imageModelId ?? profile?.hedra_image_model_id ?? "").trim();
    if (!imageModelId) throw new Error("Configure o modelo de imagem do avatar antes de gerar cenas");

    // Automatic context: avatar persona summary keeps generated scenes on-brand.
    const { data: persona } = await service
      .from("presenter_personas")
      .select("structured_persona")
      .eq("avatar_id", scene.avatar_id)
      .eq("user_id", user.id)
      .maybeSingle();
    const personaSummary = readString(
      (persona?.structured_persona as Record<string, unknown> | null)?.summary,
    );

    const styleSuffix = STYLE_SUFFIX[String(scene.image_style)] ?? STYLE_SUFFIX.realista;
    const prompt = [basePrompt, personaSummary ? `contexto do avatar: ${personaSummary}` : null, styleSuffix]
      .filter(Boolean)
      .join(" — ");

    // Each image model supports different aspect ratios / resolutions — resolve from the catalog.
    let modelAspects: string[] = [];
    let modelResolutions: string[] = [];
    let modelName = "";
    let requiresStartFrame = false;
    try {
      const rawModels = await hedraRequest<unknown>("/models");
      const m = (Array.isArray(rawModels) ? rawModels : []).find(
        (x) => String((x as Record<string, unknown>)?.id) === imageModelId,
      ) as Record<string, unknown> | undefined;
      if (m) {
        modelAspects = Array.isArray(m.aspect_ratios) ? m.aspect_ratios.map(String) : [];
        modelResolutions = Array.isArray(m.resolutions) ? m.resolutions.map(String) : [];
        modelName = String(m.name ?? "");
        requiresStartFrame = m.requires_start_frame === true;
      }
    } catch {
      // ignore — fall back to defaults
    }
    const aspectRatio = ["9:16", "3:4", "2:3", "4:5"].find((a) => modelAspects.includes(a)) ??
      (modelAspects[0] ?? "9:16");
    const resolution = ["auto", "720p", "1K", "1024x1536", "1024x1024", "2K"].find((r) =>
      modelResolutions.includes(r)
    ) ?? null;

    // Reference/base image to steer image-to-image generation. Prefer a per-scene
    // reference picked from the avatar library (validated to belong to this user's
    // avatar); fall back to the avatar's approved base image.
    let referenceAssetId: string | null = null;
    const refRequested = readString(body.referenceImageId);
    if (refRequested) {
      const { data: refImg } = await service
        .from("presenter_avatar_images")
        .select("provider_asset_id")
        .eq("avatar_id", scene.avatar_id)
        .eq("user_id", user.id)
        .eq("provider_asset_id", refRequested)
        .maybeSingle();
      if (refImg?.provider_asset_id) referenceAssetId = String(refImg.provider_asset_id);
    }
    const baseAssetId = referenceAssetId ?? readString(profile?.hedra_image_asset_id);

    // Image-to-image models (requires_start_frame) need a base/reference image. Without one
    // Hedra fails async with a cryptic "Field required", so reject early with a clear message.
    if (requiresStartFrame && !baseAssetId) {
      throw new Error(
        `O modelo ${modelName || "selecionado"} é image-to-image e precisa de uma imagem base do avatar. ` +
        `Escolha um modelo text-to-image (T2I) ou defina a foto base do avatar.`,
      );
    }

    const useImageToImage = Boolean(baseAssetId) && requiresStartFrame;
    const generationBody: Record<string, unknown> = {
      type: useImageToImage ? "image_to_image" : "image",
      text_prompt: prompt,
      ai_model_id: imageModelId,
      aspect_ratio: aspectRatio,
      batch_size: 1,
      enhance_prompt: false,
      // Models that require a start frame expect it as start_keyframe_id; older ones
      // accept reference_image_ids. Send both when steering from a base image.
      ...(useImageToImage ? { start_keyframe_id: baseAssetId, reference_image_ids: [baseAssetId] } : {}),
      ...(resolution ? { resolution } : {}),
    };

    const generation = await hedraRequest<Record<string, unknown>>("/generations", {
      body: generationBody,
    });

    const generationId = readString(generation.id);
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
          image_model_id: imageModelId,
          resolution,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", scene.id)
      .select("*")
      .single();
    if (error || !updated) throw error ?? new Error("Falha ao salvar geração da cena");

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
