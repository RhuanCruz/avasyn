import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";

// Marks an existing avatar image (e.g. a scene image) as the avatar's approved
// base photo. Works for images with no image_set (scene-generated/uploaded).
Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const imageId = String(body.imageId ?? "").trim();
    if (!imageId) throw new Error("imageId is required");

    const { data: image, error: imageError } = await service
      .from("presenter_avatar_images")
      .select("*")
      .eq("id", imageId)
      .eq("user_id", user.id)
      .single();
    if (imageError || !image) throw new Error("Imagem não encontrada");
    if (!image.provider_asset_id) throw new Error("Imagem ainda não tem asset Hedra");

    const { data: updatedImage } = await service
      .from("presenter_avatar_images")
      .update({
        kind: image.source === "upload" ? "upload" : "base",
        status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", image.id)
      .eq("user_id", user.id)
      .select("*")
      .single();

    const { data: profile, error: profileError } = await service
      .from("presenter_avatar_profiles")
      .update({
        approved_base_image_id: image.id,
        approved_image_set_id: image.image_set_id ?? null,
        hedra_image_asset_id: image.provider_asset_id,
        visual_provider: image.source === "upload" ? "upload" : "hedra",
        visual_status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("avatar_id", image.avatar_id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (profileError || !profile) throw profileError ?? new Error("Falha ao atualizar o perfil do avatar");

    return jsonResponse({ image: updatedImage ?? image, profile });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
