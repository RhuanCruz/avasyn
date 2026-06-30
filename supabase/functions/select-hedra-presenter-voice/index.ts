import { handleOptions, jsonResponse } from "../_shared/cors.ts";
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
    const voiceId = String(body.voiceId ?? "").trim();
    const name = String(body.name ?? voiceId).trim();
    const language = optionalString(body.language);
    const gender = optionalString(body.gender);
    const previewAudioUrl = optionalString(body.previewAudioUrl);
    if (!voiceId) throw new Error("voiceId is required");

    await service
      .from("presenter_voice_options")
      .update({ selected: false })
      .eq("avatar_id", avatar.id)
      .eq("user_id", user.id);

    const { data: voice, error: voiceError } = await service
      .from("presenter_voice_options")
      .upsert({
        user_id: user.id,
        avatar_id: avatar.id,
        voice_id: voiceId,
        name,
        language,
        gender,
        preview_audio_url: previewAudioUrl,
        selected: true,
      }, { onConflict: "avatar_id,voice_id" })
      .select("*")
      .single();
    if (voiceError || !voice) throw voiceError ?? new Error("Failed to save voice");

    const { data: profile, error: profileError } = await service
      .from("presenter_avatar_profiles")
      .update({
        selected_voice_id: voiceId,
        hedra_voice_id: voiceId,
        voice_provider: "hedra",
        voice_status: "public_selected",
        updated_at: new Date().toISOString(),
      })
      .eq("avatar_id", avatar.id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (profileError || !profile) throw profileError ?? new Error("Failed to update presenter profile");

    return jsonResponse({ profile, voice });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
