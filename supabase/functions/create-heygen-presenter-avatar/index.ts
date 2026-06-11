import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";
import {
  extractHeyGenAvatarProfile,
  heygenRequest,
} from "../_shared/heygen.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);
    const visualDescription = String(body.visualDescription ?? "").trim();

    const { data: profile, error: profileError } = await service
      .from("presenter_avatar_profiles")
      .select("*")
      .eq("avatar_id", avatar.id)
      .eq("user_id", user.id)
      .single();
    if (profileError || !profile) throw new Error("Presenter profile not found");

    const { data: persona } = await service
      .from("presenter_personas")
      .select("structured_persona,status")
      .eq("avatar_id", avatar.id)
      .eq("user_id", user.id)
      .maybeSingle();

    const visualPrompt = buildVisualPrompt({
      avatarName: avatar.name,
      mainTopic: profile.main_topic,
      persona: persona?.structured_persona,
      visualDescription,
    });

    const response = await heygenRequest<unknown>("/v3/avatars", {
      idempotencyKey: `${avatar.id}:presenter-avatar`,
      body: {
        type: "prompt",
        name: avatar.name,
        prompt: visualPrompt,
        ...(profile.heygen_avatar_group_id
          ? { avatar_group_id: profile.heygen_avatar_group_id }
          : {}),
      },
    });
    const heygenProfile = extractHeyGenAvatarProfile(response);

    const { data: updatedProfile, error } = await service
      .from("presenter_avatar_profiles")
      .update({
        visual_prompt: visualPrompt,
        visual_prompt_status: "approved",
        heygen_avatar_group_id: heygenProfile.groupId,
        heygen_avatar_id: heygenProfile.lookId,
        heygen_preview_image_url: heygenProfile.previewImageUrl,
        heygen_preview_video_url: heygenProfile.previewVideoUrl,
        default_voice_id: heygenProfile.defaultVoiceId,
        selected_voice_id: profile.selected_voice_id ?? heygenProfile.defaultVoiceId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id)
      .select("*")
      .single();
    if (error || !updatedProfile) throw error ?? new Error("Failed to save HeyGen avatar");

    return jsonResponse({ profile: updatedProfile });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function buildVisualPrompt({
  avatarName,
  mainTopic,
  persona,
  visualDescription,
}: {
  avatarName: string;
  mainTopic: string;
  persona: unknown;
  visualDescription: string;
}) {
  const structured = persona && typeof persona === "object"
    ? persona as Record<string, unknown>
    : {};
  const tone = typeof structured.tone === "string" ? structured.tone : "confiante e natural";
  const voice = typeof structured.voice === "string" ? structured.voice : "apresentador claro";
  const description = visualDescription || "aparência moderna, profissional e memorável";

  return [
    `Create a realistic presenter avatar named ${avatarName}.`,
    `Main content topic: ${mainTopic}.`,
    `Visual direction: ${description}.`,
    `Personality cues: ${tone}; ${voice}.`,
    "Brazilian Portuguese social video presenter, expressive but credible, clean studio-ready look.",
    "Half-body framing, camera-facing, natural posture, strong identity consistency.",
  ].join(" ");
}
