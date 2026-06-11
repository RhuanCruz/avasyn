import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";
import { createStructuredResponse } from "../_shared/openai.ts";

type StructuredPersona = {
  summary: string;
  voice: string;
  tone: string;
  beliefs: string[];
  loves: string[];
  avoids: string[];
  catchphrases: string[];
  script_guidelines: string[];
  safety_notes: string[];
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);
    const rawPersona = String(body.rawPersona ?? "").trim();
    if (rawPersona.length < 20) {
      throw new Error("Descreva a persona com pelo menos 20 caracteres");
    }

    const { data: profile, error: profileError } = await service
      .from("presenter_avatar_profiles")
      .select("main_topic")
      .eq("avatar_id", avatar.id)
      .eq("user_id", user.id)
      .single();
    if (profileError || !profile) throw new Error("Presenter profile not found");

    const structured = await createStructuredResponse<StructuredPersona>({
      schemaName: "presenter_persona",
      schema: personaSchema,
      input: [
        {
          role: "developer",
          content: [{
            type: "input_text",
            text: [
              "Você é um diretor de personagem para vídeos curtos em português do Brasil.",
              "Transforme o texto bruto em uma ficha de persona útil para roteiros de vídeo.",
              "Não invente histórico pessoal sensível. Preserve a intenção do usuário e torne a voz acionável.",
              "Responda apenas no schema JSON solicitado.",
            ].join("\n"),
          }],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify({
              avatarName: avatar.name,
              mainTopic: profile.main_topic,
              rawPersona,
            }),
          }],
        },
      ],
    });

    const { data: persona, error } = await service
      .from("presenter_personas")
      .upsert({
        user_id: user.id,
        avatar_id: avatar.id,
        raw_persona: rawPersona,
        structured_persona: structured,
        status: "generated",
        updated_at: new Date().toISOString(),
      }, { onConflict: "avatar_id" })
      .select("*")
      .single();
    if (error || !persona) throw error ?? new Error("Failed to save persona");

    await service
      .from("avatars")
      .update({
        persona_summary: structured.summary,
        about: rawPersona,
      })
      .eq("id", avatar.id)
      .eq("user_id", user.id);

    return jsonResponse({ persona });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

const personaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    voice: { type: "string" },
    tone: { type: "string" },
    beliefs: { type: "array", items: { type: "string" } },
    loves: { type: "array", items: { type: "string" } },
    avoids: { type: "array", items: { type: "string" } },
    catchphrases: { type: "array", items: { type: "string" } },
    script_guidelines: { type: "array", items: { type: "string" } },
    safety_notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "summary",
    "voice",
    "tone",
    "beliefs",
    "loves",
    "avoids",
    "catchphrases",
    "script_guidelines",
    "safety_notes",
  ],
};
