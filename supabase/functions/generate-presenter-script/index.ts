import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";
import { createStructuredResponse } from "../_shared/openai.ts";
import { buildValidatedPresenterScript } from "./script-pipeline.ts";
import type { PresenterScript } from "./script-quality.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);
    const topic = String(body.topic ?? "").trim();
    const projectId = typeof body.projectId === "string" ? body.projectId : null;
    if (topic.length < 3) {
      throw new Error("Informe o tema do vídeo");
    }

    const [{ data: profile }, { data: persona }] = await Promise.all([
      service
        .from("presenter_avatar_profiles")
        .select("*")
        .eq("avatar_id", avatar.id)
        .eq("user_id", user.id)
        .single(),
      service
        .from("presenter_personas")
        .select("*")
        .eq("avatar_id", avatar.id)
        .eq("user_id", user.id)
        .single(),
    ]);
    if (!profile) throw new Error("Presenter profile not found");
    if (!persona || persona.status !== "approved") {
      throw new Error("Aprove a persona antes de gerar roteiros");
    }

    if (projectId) {
      const { error } = await service
        .from("presenter_video_projects")
        .update({
          error_message: null,
          status: "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId)
        .eq("avatar_id", avatar.id)
        .eq("user_id", user.id);
      if (error) throw error;
    }

    const result = await buildValidatedPresenterScript({
      createDraft: () => createPresenterScript({
        avatarName: avatar.name,
        mainTopic: profile.main_topic,
        persona: persona.structured_persona,
        topic,
      }),
      repairDraft: ({ firstDraft, reasons }) => repairPresenterScript({
        avatarName: avatar.name,
        firstDraft,
        mainTopic: profile.main_topic,
        persona: persona.structured_persona,
        reasons,
        topic,
      }),
    });

    const saveQuery = projectId
      ? service
        .from("presenter_video_projects")
        .update({
          topic,
          research_summary: result.research,
          script: result,
          script_text: result.script_text,
          status: "script_pending_review",
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId)
        .eq("avatar_id", avatar.id)
        .eq("user_id", user.id)
      : service
        .from("presenter_video_projects")
        .insert({
        user_id: user.id,
        avatar_id: avatar.id,
        topic,
        research_summary: result.research,
        script: result,
        script_text: result.script_text,
        status: "script_pending_review",
      });

    const { data: project, error } = await saveQuery
      .select("*")
      .single();
    if (error || !project) throw error ?? new Error("Failed to save script");

    return jsonResponse({ project });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

const scriptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    hook: { type: "string" },
    angle: { type: "string" },
    promise: { type: "string" },
    script_text: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          beat: { type: "string" },
          narration: { type: "string" },
          on_screen_text: { type: "string" },
        },
        required: ["beat", "narration", "on_screen_text"],
      },
    },
    research: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        signals: { type: "array", items: { type: "string" } },
        sources: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              url: { type: "string" },
            },
            required: ["title", "url"],
          },
        },
      },
      required: ["summary", "signals", "sources"],
    },
    safety_notes: { type: "array", items: { type: "string" } },
    quality_notes: { type: "array", items: { type: "string" } },
    word_count: { type: "number" },
  },
  required: [
    "title",
    "hook",
    "angle",
    "promise",
    "script_text",
    "scenes",
    "research",
    "safety_notes",
    "quality_notes",
    "word_count",
  ],
};

async function createPresenterScript({
  avatarName,
  mainTopic,
  persona,
  topic,
}: {
  avatarName: string;
  mainTopic: string;
  persona: unknown;
  topic: string;
}) {
  return await createStructuredResponse<PresenterScript>({
    schemaName: "presenter_video_script",
    schema: scriptSchema,
    tools: [{ type: "web_search" }],
    toolChoice: "required",
    maxOutputTokens: 9000,
    input: [
      {
        role: "developer",
        content: [{
          type: "input_text",
          text: presenterScriptInstructions,
        }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({
            task: "Pesquise, crie um brief editorial e escreva o roteiro completo.",
            avatarName,
            mainTopic,
            topic,
            persona,
            durationSeconds: 45,
            aspectRatio: "9:16",
            language: "pt-BR",
            targetWordCount: "110-150",
          }),
        }],
      },
    ],
  });
}

async function repairPresenterScript({
  avatarName,
  firstDraft,
  mainTopic,
  persona,
  reasons,
  topic,
}: {
  avatarName: string;
  firstDraft: PresenterScript;
  mainTopic: string;
  persona: unknown;
  reasons: string[];
  topic: string;
}) {
  return await createStructuredResponse<PresenterScript>({
    schemaName: "presenter_video_script_repair",
    schema: scriptSchema,
    maxOutputTokens: 9000,
    input: [
      {
        role: "developer",
        content: [{
          type: "input_text",
          text: [
            presenterScriptInstructions,
            "",
            "Você está reparando um roteiro que falhou na validação automática.",
            "Preserve as fontes e os fatos úteis da pesquisa original, mas reescreva o roteiro inteiro se necessário.",
            "A resposta reparada precisa cumprir todos os critérios mínimos.",
          ].join("\n"),
        }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({
            task: "Repare o roteiro mantendo pesquisa real e voz da persona.",
            validationFailures: reasons,
            avatarName,
            mainTopic,
            topic,
            persona,
            durationSeconds: 45,
            aspectRatio: "9:16",
            targetWordCount: "110-150",
            firstDraft,
          }),
        }],
      },
    ],
  });
}

const presenterScriptInstructions = [
  "Você é um roteirista sênior de vídeos curtos em português do Brasil e pesquisador editorial.",
  "O objetivo é entregar um roteiro pronto para TTS/HeyGen, não um resumo.",
  "",
  "Processo obrigatório antes de escrever:",
  "1. Use web search para encontrar sinais atuais e fontes reais sobre o tema.",
  "2. Sintetize um brief editorial: fato central, tensão, ângulo diferenciado e promessa do vídeo.",
  "3. Escreva um roteiro vertical 9:16 de 45 segundos com 110 a 150 palavras.",
  "4. Divida em pelo menos 5 cenas/beats: hook, contexto, tensão, insight/opinião da persona e fechamento.",
  "",
  "Regras de escrita:",
  "- Comece com tensão, contraste, dado ou pergunta forte. Não comece com 'Fala, galera', 'hoje vamos falar' ou introdução genérica.",
  "- O texto precisa soar como a persona aprovada: use tom, crenças, bordões e limites informados.",
  "- Não descreva aparência do avatar.",
  "- Não invente dados, datas, diagnóstico, escalação ou certeza sem fonte.",
  "- Se houver incerteza nas fontes, escreva como incerteza.",
  "- Nunca coloque URLs, domínios, links, datas numéricas ou datas cruas no script_text ou na narração das cenas.",
  "- Links ficam somente em research.sources. Datas devem virar linguagem falada natural quando forem indispensáveis.",
  "- Cada cena deve ter narração falável e on_screen_text curto.",
  "- script_text deve conter o roteiro completo, com começo, meio e fim; não pode ser só o hook.",
  "- quality_notes deve explicar rapidamente como o roteiro cumpre hook, pesquisa, voz e estrutura.",
  "Responda apenas no JSON schema solicitado.",
].join("\n");
