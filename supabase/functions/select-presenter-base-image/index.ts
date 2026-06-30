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
    const imageId = String(body.imageId ?? "").trim();
    if (!imageId) throw new Error("imageId is required");

    const { data: image, error: imageError } = await service
      .from("presenter_avatar_images")
      .select("*")
      .eq("id", imageId)
      .eq("user_id", user.id)
      .single();
    if (imageError || !image) throw new Error("Image not found");
    if (!image.provider_asset_id) throw new Error("Imagem ainda não tem asset Hedra");

    await service
      .from("presenter_avatar_images")
      .update({
        status: "rejected",
        updated_at: new Date().toISOString(),
      })
      .eq("image_set_id", image.image_set_id)
      .eq("user_id", user.id)
      .neq("id", image.id);

    const { data: selectedImage, error: selectedError } = await service
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
    if (selectedError || !selectedImage) throw selectedError ?? new Error("Failed to approve image");

    const { data: imageSet, error: setError } = await service
      .from("presenter_image_sets")
      .update({
        base_image_id: selectedImage.id,
        status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedImage.image_set_id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (setError || !imageSet) throw setError ?? new Error("Failed to approve image set");

    const { data: profile, error: profileError } = await service
      .from("presenter_avatar_profiles")
      .update({
        approved_base_image_id: selectedImage.id,
        approved_image_set_id: imageSet.id,
        hedra_image_asset_id: selectedImage.provider_asset_id,
        visual_provider: selectedImage.source,
        visual_status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("avatar_id", selectedImage.avatar_id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (profileError || !profile) throw profileError ?? new Error("Failed to update presenter profile");

    return jsonResponse({ image: selectedImage, imageSet, profile });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
