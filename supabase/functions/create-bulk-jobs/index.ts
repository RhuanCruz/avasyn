import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";
import { createStructuredResponse } from "../_shared/openai.ts";
import {
  type BulkTextCombination,
  type GeneratedBulkText,
  normalizeGeneratedTexts,
} from "./bulk-texts.ts";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const authorization = request.headers.get("Authorization");
    const body = await request.json();
    const sourceVideoIds = uniqueStrings(body.sourceVideoIds);
    const reactionIds = uniqueStrings(body.reactionIds);
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);

    if (sourceVideoIds.length === 0) {
      throw new Error("sourceVideoIds is required");
    }

    if (reactionIds.length === 0) {
      throw new Error("reactionIds is required");
    }

    const totalJobs = sourceVideoIds.length * reactionIds.length;
    if (totalJobs > 100) {
      throw new Error("Bulk editor supports up to 100 jobs at a time");
    }

    const { data: sourceVideos, error: sourceError } = await service
      .from("source_videos")
      .select("id, name, storage_path, source_url, source_platform")
      .eq("user_id", user.id)
      .eq("avatar_id", avatar.id)
      .in("id", sourceVideoIds);
    if (sourceError) throw sourceError;
    if ((sourceVideos?.length ?? 0) !== sourceVideoIds.length) {
      throw new Error("Invalid source video selection");
    }

    const { data: reactions, error: reactionError } = await service
      .from("reaction_videos")
      .select("id")
      .eq("user_id", user.id)
      .eq("avatar_id", avatar.id)
      .in("id", reactionIds);
    if (reactionError) throw reactionError;
    if ((reactions?.length ?? 0) !== reactionIds.length) {
      throw new Error("Invalid reaction selection");
    }

    const sourceVideoById = new Map((sourceVideos ?? []).map((sourceVideo) => [
      sourceVideo.id,
      sourceVideo,
    ]));
    const orderedSourceVideos = sourceVideoIds.map((id) => sourceVideoById.get(id)!);
    const combinations = orderedSourceVideos.flatMap((sourceVideo) =>
      reactionIds.map((reactionId) => ({ sourceVideo, reactionId })),
    );
    const generatedTexts = await generateBulkTexts({
      captionBrief: String(body.caption ?? ""),
      combinations,
      overlayBrief: String(body.overlayText ?? ""),
    });

    const rows = combinations.map(({ reactionId, sourceVideo }, index) => ({
        user_id: user.id,
        avatar_id: avatar.id,
        account_id: null,
        source_video_id: sourceVideo.id,
        reaction_id: reactionId,
        clip_url: `source-video:${sourceVideo.id}`,
        overlay_text: generatedTexts[index].overlayText,
        caption: generatedTexts[index].caption,
        scheduled_post_at: null,
      }));

    const { data: jobs, error } = await service
      .from("reel_jobs")
      .insert(rows)
      .select("id");
    if (error) throw error;

    for (const job of jobs ?? []) {
      const { error: enqueueError } = await service.rpc("enqueue_reel_job", {
        job_id: job.id,
      });
      if (enqueueError) throw enqueueError;
    }

    if ((jobs?.length ?? 0) > 0) {
      EdgeRuntime.waitUntil(triggerProcessor(jobs ?? [], authorization));
    }

    return jsonResponse({ count: jobs?.length ?? 0, jobs });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(String).filter(Boolean)));
}

async function generateBulkTexts({
  captionBrief,
  combinations,
  overlayBrief,
}: {
  captionBrief: string;
  combinations: BulkTextCombination[];
  overlayBrief: string;
}): Promise<GeneratedBulkText[]> {
  const parsed = await createStructuredResponse<{ items?: GeneratedBulkText[] }>({
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: [
              "Você gera textos curtos para Reels de futebol em português do Brasil.",
              "Responda apenas no JSON schema solicitado.",
              "Crie exatamente um item por combinação recebida, na mesma ordem.",
              "Atenção: você NÃO conhece o conteúdo visual real dos vídeos. Não invente o que aconteceu no lance.",
              "overlayText deve ser genérico, funcionar para qualquer lance, ter no máximo 3 palavras, sem emoji, sem hashtag e sem pontuação exagerada.",
              "caption deve ser genérica, curta, variada entre itens e não pode afirmar eventos específicos do vídeo.",
              "Evite palavras específicas como gol, golaço, defesa, falta, pênalti, drible, chute, goleiro ou craque.",
              "Prefira chamadas neutras como: Olha isso, Que lance, Sem palavras, Que cena, Essa reação diz tudo.",
              "Evite repetir overlayText ou caption dentro do mesmo lote.",
            ].join("\n"),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              captionBrief,
              combinations: combinations.map((combination, index) => ({
                index,
                reactionId: combination.reactionId,
                sourceName: combination.sourceVideo.name,
                sourcePlatform: combination.sourceVideo.source_platform,
                sourceUrl: combination.sourceVideo.source_url,
              })),
              overlayBrief,
              totalItems: combinations.length,
            }),
          },
        ],
      },
    ],
    maxOutputTokens: Math.min(12000, 500 + combinations.length * 120),
    schemaName: "bulk_video_texts",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          minItems: combinations.length,
          maxItems: combinations.length,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              caption: { type: "string" },
              overlayText: { type: "string" },
            },
            required: ["caption", "overlayText"],
          },
        },
      },
      required: ["items"],
    },
  });

  if (!Array.isArray(parsed.items) || parsed.items.length !== combinations.length) {
    throw new Error("Bulk text generation returned an invalid item count");
  }

  return normalizeGeneratedTexts(parsed.items, combinations);
}

async function triggerProcessor(
  jobs: Array<{ id: string }>,
  authorization: string | null,
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl || !authorization) {
    throw new Error("Missing SUPABASE_URL or authenticated request");
  }

  const concurrency = 3;
  for (let index = 0; index < jobs.length; index += concurrency) {
    const batch = jobs.slice(index, index + concurrency);
    await Promise.all(
      batch.map(async (job) => {
      const response = await fetch(`${supabaseUrl}/functions/v1/reel-processor`, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId: job.id }),
      });

      if (!response.ok) {
        throw new Error(`Failed to trigger reel-processor: ${await response.text()}`);
      }
      }),
    );
  }
}
