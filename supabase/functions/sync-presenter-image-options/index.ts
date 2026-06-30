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
    const imageSetId = String(body.imageSetId ?? "").trim();
    if (!imageSetId) throw new Error("imageSetId is required");

    const { data: imageSet, error: imageSetError } = await service
      .from("presenter_image_sets")
      .select("*")
      .eq("id", imageSetId)
      .eq("user_id", user.id)
      .single();
    if (imageSetError || !imageSet) throw new Error("Image set not found");

    const batchResults = Array.isArray(imageSet.metadata?.batch_results)
      ? imageSet.metadata.batch_results as Array<Record<string, unknown>>
      : [];
    const generationIds = batchResults
      .map((item) => readString(item.id))
      .filter((id): id is string => Boolean(id));
    const fallbackGenerationId = readString(imageSet.metadata?.hedra_generation_id);
    if (generationIds.length === 0 && fallbackGenerationId) {
      generationIds.push(fallbackGenerationId);
    }
    if (generationIds.length === 0) throw new Error("Image set has no Hedra generation ids");

    const statuses = await Promise.all(
      generationIds.map((generationId) =>
        hedraRequest<Record<string, unknown>>(`/generations/${encodeURIComponent(generationId)}/status`)
      ),
    );

    const errored = statuses.find((status) => mapHedraGenerationStatus(readString(status.status)) === "error");
    if (errored) {
      const errorMessage = readString(errored.error_message) ?? "Hedra image generation failed";
      const { data: updatedSet } = await service
        .from("presenter_image_sets")
        .update({
          error_message: errorMessage,
          status: "error",
          updated_at: new Date().toISOString(),
        })
        .eq("id", imageSet.id)
        .select("*")
        .single();
      return jsonResponse({ imageSet: updatedSet ?? imageSet, images: [] });
    }

    const completeStatuses = statuses.filter((status) =>
      mapHedraGenerationStatus(readString(status.status)) === "completed"
    );
    if (completeStatuses.length !== statuses.length) {
      return jsonResponse({ imageSet, images: [], pending: true, statuses });
    }

    const { data: existingImages, error: existingError } = await service
      .from("presenter_avatar_images")
      .select("*")
      .eq("image_set_id", imageSet.id);
    if (existingError) throw existingError;
    if ((existingImages?.length ?? 0) === 0) {
      const rows = completeStatuses.map((status, index) => ({
        user_id: user.id,
        avatar_id: imageSet.avatar_id,
        image_set_id: imageSet.id,
        kind: "option",
        source: "hedra",
        status: "generated",
        prompt: imageSet.prompt_original,
        improved_prompt: imageSet.prompt_improved,
        preview_url: readString(status.download_url) ?? readString(status.url) ?? readString(status.streaming_url),
        provider: "hedra",
        provider_asset_id: readString(status.asset_id),
        provider_generation_id: readString(status.id),
        metadata: { index, raw_status: status },
      }));

      const { error: insertError } = await service
        .from("presenter_avatar_images")
        .insert(rows);
      if (insertError) throw insertError;
    }

    const { data: updatedSet, error: updateError } = await service
      .from("presenter_image_sets")
      .update({
        status: "options_generated",
        updated_at: new Date().toISOString(),
      })
      .eq("id", imageSet.id)
      .select("*")
      .single();
    if (updateError || !updatedSet) throw updateError ?? new Error("Failed to update image set");

    const { data: images, error: imagesError } = await service
      .from("presenter_avatar_images")
      .select("*")
      .eq("image_set_id", imageSet.id)
      .order("created_at", { ascending: true });
    if (imagesError) throw imagesError;

    return jsonResponse({ imageSet: updatedSet, images: images ?? [] });
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
