import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createHedraAsset, uploadHedraAsset } from "../_shared/hedra.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// Scene-scoped image upload: registers the uploaded image as the scene's image
// (its own Hedra asset) WITHOUT touching the avatar's approved base image.
// The client uploads to storage and passes a signed URL so we fetch the bytes
// directly (no storage backend coupling here).
Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const sceneId = String(body.sceneId ?? "").trim();
    const storagePath = String(body.storagePath ?? "").trim();
    const imageUrl = String(body.imageUrl ?? "").trim();
    const filename = String(body.filename ?? "scene-image.png").trim();
    const contentType = String(body.contentType ?? "").trim();
    if (!sceneId) throw new Error("sceneId is required");
    if (!imageUrl) throw new Error("imageUrl is required");
    if (storagePath && !storagePath.startsWith(`${user.id}/`)) throw new Error("Forbidden storage path");
    if (!ALLOWED_MIME.has(contentType)) throw new Error("Formato de imagem inválido");

    const { data: scene, error: sceneError } = await service
      .from("presenter_video_scenes")
      .select("*")
      .eq("id", sceneId)
      .eq("user_id", user.id)
      .single();
    if (sceneError || !scene) throw new Error("Cena não encontrada");

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) throw new Error("Falha ao baixar a imagem enviada");
    const bytes = await imageResponse.arrayBuffer();

    const asset = await createHedraAsset({ name: filename, type: "image" });
    await uploadHedraAsset({ assetId: asset.id, bytes, filename, type: contentType });

    const { data: image, error: imageError } = await service
      .from("presenter_avatar_images")
      .insert({
        user_id: user.id,
        avatar_id: scene.avatar_id,
        image_set_id: null,
        kind: "upload",
        source: "upload",
        status: "generated",
        storage_path: storagePath || null,
        preview_url: imageUrl,
        provider: "upload",
        provider_asset_id: asset.id,
        metadata: { filename, contentType, scene_id: scene.id },
      })
      .select("*")
      .single();
    if (imageError || !image) throw imageError ?? new Error("Falha ao salvar imagem");

    const { data: updated, error } = await service
      .from("presenter_video_scenes")
      .update({
        content_status: "ready",
        image_source: "upload",
        image_id: image.id,
        hedra_image_asset_id: asset.id,
        error_message: null,
        metadata: { ...(scene.metadata ?? {}), preview_url: imageUrl },
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
