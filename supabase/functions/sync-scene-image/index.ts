import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { hedraRequest, mapHedraGenerationStatus } from "../_shared/hedra.ts";
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
    const sceneId = String(body.sceneId ?? "").trim();
    if (!sceneId) throw new Error("sceneId is required");

    const { data: scene, error: sceneError } = await service
      .from("presenter_video_scenes")
      .select("*")
      .eq("id", sceneId)
      .eq("user_id", user.id)
      .single();
    if (sceneError || !scene) throw new Error("Cena não encontrada");

    const existingPreview = readString((scene.metadata as Record<string, unknown> | null)?.preview_url);

    // Already resolved.
    if (scene.content_status === "ready" && scene.image_id) {
      // Backfill the preview URL if a previous sync stored the asset but no URL.
      if (!existingPreview && scene.hedra_image_asset_id) {
        const url = await fetchAssetUrl("image", scene.hedra_image_asset_id);
        if (url) {
          await service.from("presenter_avatar_images")
            .update({ preview_url: url, updated_at: new Date().toISOString() })
            .eq("id", scene.image_id);
          const { data: patched } = await service.from("presenter_video_scenes")
            .update({ metadata: { ...(scene.metadata ?? {}), preview_url: url }, updated_at: new Date().toISOString() })
            .eq("id", scene.id).select("*").single();
          return jsonResponse({ scene: patched ?? scene });
        }
      }
      return jsonResponse({ scene });
    }

    const generationId = readString(scene.hedra_generation_id) ??
      readString((scene.metadata as Record<string, unknown> | null)?.hedra_generation_id);
    if (!generationId) throw new Error("Cena não tem geração Hedra");

    const status = await hedraRequest<Record<string, unknown>>(
      `/generations/${encodeURIComponent(generationId)}/status`,
    );
    const mapped = mapHedraGenerationStatus(readString(status.status));

    if (mapped === "error") {
      const { data: updated } = await service
        .from("presenter_video_scenes")
        .update({
          content_status: "error",
          error_message: readString(status.error_message) ?? "Falha na geração da imagem",
          updated_at: new Date().toISOString(),
        })
        .eq("id", scene.id)
        .select("*")
        .single();
      return jsonResponse({ scene: updated ?? scene });
    }

    if (mapped !== "completed") {
      return jsonResponse({ scene, pending: true });
    }

    const assetId = readString(status.asset_id);
    // For image generations the status often has no URL — fetch it from the asset.
    let previewUrl = readString(status.download_url) ??
      readString(status.url) ??
      readString(status.streaming_url);
    if (!previewUrl && assetId) previewUrl = await fetchAssetUrl("image", assetId);

    const { data: image, error: imageError } = await service
      .from("presenter_avatar_images")
      .insert({
        user_id: user.id,
        avatar_id: scene.avatar_id,
        image_set_id: null,
        kind: "variation",
        source: "hedra",
        status: "generated",
        prompt: scene.prompt,
        improved_prompt: scene.improved_prompt,
        variation_label: "cena",
        preview_url: previewUrl,
        provider: "hedra",
        provider_asset_id: assetId,
        provider_generation_id: generationId,
        metadata: { scene_id: scene.id, raw_status: status },
      })
      .select("*")
      .single();
    if (imageError || !image) throw imageError ?? new Error("Falha ao salvar imagem da cena");

    const { data: updated, error } = await service
      .from("presenter_video_scenes")
      .update({
        content_status: "ready",
        image_id: image.id,
        hedra_image_asset_id: assetId,
        error_message: null,
        metadata: { ...(scene.metadata ?? {}), preview_url: previewUrl },
        updated_at: new Date().toISOString(),
      })
      .eq("id", scene.id)
      .select("*")
      .single();
    if (error || !updated) throw error ?? new Error("Falha ao atualizar cena");

    return jsonResponse({ scene: updated });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

// Hedra image/video URLs live on the asset, not always on the generation status.
async function fetchAssetUrl(type: "image" | "video", assetId: string): Promise<string | null> {
  try {
    const res = await hedraRequest<unknown>(`/assets?type=${type}&ids=${encodeURIComponent(assetId)}`);
    const list = Array.isArray(res)
      ? res
      : (Array.isArray((res as Record<string, unknown>)?.assets) ? (res as Record<string, unknown>).assets as unknown[] : []);
    const first = (list[0] ?? null) as Record<string, unknown> | null;
    if (!first) return null;
    const inner = (first.asset ?? {}) as Record<string, unknown>;
    return readString(inner.download_url) ?? readString(inner.url) ?? readString(first.thumbnail_url);
  } catch {
    return null;
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
