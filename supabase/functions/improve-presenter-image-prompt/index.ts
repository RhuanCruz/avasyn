import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createStructuredResponse } from "../_shared/openai.ts";
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
    const rawPrompt = String(body.rawPrompt ?? "").trim();
    if (rawPrompt.length < 10) {
      throw new Error("Descreva o visual com pelo menos 10 caracteres");
    }

    const [{ data: profile }, { data: persona }] = await Promise.all([
      service
        .from("presenter_avatar_profiles")
        .select("main_topic")
        .eq("avatar_id", avatar.id)
        .eq("user_id", user.id)
        .maybeSingle(),
      service
        .from("presenter_personas")
        .select("structured_persona,status")
        .eq("avatar_id", avatar.id)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const result = await createStructuredResponse<{
      improvedPrompt: string;
      negativePromptGuidance: string;
      styleNotes: string[];
    }>({
      schemaName: "presenter_image_prompt",
      schema: imagePromptSchema,
      maxOutputTokens: 2200,
      input: [
        {
          role: "developer",
          content: [{
            type: "input_text",
            text: [
              "Você é diretor visual de avatares presenter para vídeos verticais.",
              "Transforme o pedido bruto em um prompt de imagem claro, específico e consistente.",
              "Preserve identidade, idade aparente, roupa, cenário e energia do personagem.",
              "Não mencione marcas registradas, pessoas reais ou instruções de texto na imagem.",
              "Responda em português com prompt pronto para geração de imagem.",
            ].join("\n"),
          }],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify({
              avatarName: avatar.name,
              mainTopic: profile?.main_topic,
              persona: persona?.status === "approved" ? persona.structured_persona : null,
              rawPrompt,
              target: "avatar presenter vertical 9:16, retrato realista/semirrealista, pronto para lip sync",
            }),
          }],
        },
      ],
    });

    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

const imagePromptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    improvedPrompt: { type: "string" },
    negativePromptGuidance: { type: "string" },
    styleNotes: { type: "array", items: { type: "string" } },
  },
  required: ["improvedPrompt", "negativePromptGuidance", "styleNotes"],
};
