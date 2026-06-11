import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";
import {
  heygenRequest,
  normalizeHeyGenVoiceOptions,
} from "../_shared/heygen.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);
    const voiceBrief = String(body.voiceBrief ?? "").trim();

    const [{ data: profile }, { data: persona }] = await Promise.all([
      service
        .from("presenter_avatar_profiles")
        .select("main_topic")
        .eq("avatar_id", avatar.id)
        .eq("user_id", user.id)
        .single(),
      service
        .from("presenter_personas")
        .select("structured_persona")
        .eq("avatar_id", avatar.id)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    if (!profile) throw new Error("Presenter profile not found");

    const prompt = buildVoicePrompt({
      avatarName: avatar.name,
      mainTopic: profile.main_topic,
      persona: persona?.structured_persona,
      voiceBrief,
    });
    const response = await heygenRequest<unknown>("/v3/voices", {
      body: {
        prompt,
        locale: "pt-BR",
        seed: typeof body.seed === "number" ? body.seed : undefined,
      },
    });
    const options = normalizeHeyGenVoiceOptions(response);
    if (options.length === 0) {
      throw new Error("HeyGen did not return voice options");
    }

    await service
      .from("presenter_voice_options")
      .delete()
      .eq("avatar_id", avatar.id)
      .eq("user_id", user.id);

    const rows = options.map((option) => ({
      user_id: user.id,
      avatar_id: avatar.id,
      voice_id: option.voiceId,
      name: option.name,
      language: option.language,
      gender: option.gender,
      preview_audio_url: option.previewAudioUrl,
      seed: option.seed,
      selected: false,
    }));
    const { data: voices, error } = await service
      .from("presenter_voice_options")
      .insert(rows)
      .select("*");
    if (error) throw error;

    return jsonResponse({ voiceBrief: prompt, voices: voices ?? [] });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function buildVoicePrompt({
  avatarName,
  mainTopic,
  persona,
  voiceBrief,
}: {
  avatarName: string;
  mainTopic: string;
  persona: unknown;
  voiceBrief: string;
}) {
  const structured = persona && typeof persona === "object"
    ? persona as Record<string, unknown>
    : {};
  const voice = typeof structured.voice === "string" ? structured.voice : "";
  const tone = typeof structured.tone === "string" ? structured.tone : "";

  return [
    voiceBrief || `Brazilian Portuguese voice for ${avatarName}, a presenter about ${mainTopic}.`,
    voice,
    tone,
    "Natural pt-BR, clear diction, social-video pacing, confident and human.",
  ].filter(Boolean).join(" ");
}
