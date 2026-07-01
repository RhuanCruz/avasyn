import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createHedraAsset, uploadHedraAsset } from "../_shared/hedra.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);
    const storagePath = String(body.storagePath ?? "").trim();
    const imageUrl = String(body.imageUrl ?? "").trim();
    const filename = String(body.filename ?? "avatar-image.png").trim();
    const contentType = String(body.contentType ?? "").trim();
    // Multi-upload into the library shouldn't hijack the avatar's approved base
    // photo on every file; callers pass setAsBase:false to just add to the library.
    const setAsBase = body.setAsBase !== false;

    if (!imageUrl) throw new Error("imageUrl is required");
    if (storagePath && !storagePath.startsWith(`${user.id}/`)) throw new Error("Forbidden storage path");
    if (!ALLOWED_MIME.has(contentType)) throw new Error("Formato de imagem inválido");

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) throw new Error("Falha ao baixar a imagem enviada");
    const bytes = await imageResponse.arrayBuffer();
    const asset = await createHedraAsset({ name: filename, type: "image" });
    await uploadHedraAsset({
      assetId: asset.id,
      bytes,
      filename,
      type: contentType,
    });
    const signedUrl = imageUrl;

    const { data: imageSet, error: setError } = await service
      .from("presenter_image_sets")
      .insert({
        user_id: user.id,
        avatar_id: avatar.id,
        status: "approved",
        provider: "upload",
        metadata: { filename, contentType },
      })
      .select("*")
      .single();
    if (setError || !imageSet) throw setError ?? new Error("Failed to save upload set");

    const { data: image, error: imageError } = await service
      .from("presenter_avatar_images")
      .insert({
        user_id: user.id,
        avatar_id: avatar.id,
        image_set_id: imageSet.id,
        kind: "upload",
        source: "upload",
        status: "approved",
        storage_path: storagePath,
        preview_url: signedUrl,
        provider: "upload",
        provider_asset_id: asset.id,
        metadata: { filename, contentType },
      })
      .select("*")
      .single();
    if (imageError || !image) throw imageError ?? new Error("Failed to save uploaded image");

    const { data: updatedSet, error: updateSetError } = await service
      .from("presenter_image_sets")
      .update({
        base_image_id: image.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", imageSet.id)
      .select("*")
      .single();
    if (updateSetError || !updatedSet) throw updateSetError ?? new Error("Failed to update upload set");

    if (!setAsBase) {
      // Library-only upload: keep the avatar's current approved base image untouched.
      return jsonResponse({ image, imageSet: updatedSet, profile: null });
    }

    const { data: profile, error: profileError } = await service
      .from("presenter_avatar_profiles")
      .update({
        approved_base_image_id: image.id,
        approved_image_set_id: updatedSet.id,
        hedra_image_asset_id: asset.id,
        visual_provider: "upload",
        visual_status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("avatar_id", avatar.id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (profileError || !profile) throw profileError ?? new Error("Failed to update presenter profile");

    return jsonResponse({ image, imageSet: updatedSet, profile });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
