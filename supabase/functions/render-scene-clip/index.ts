import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { hedraRequest, mapHedraGenerationStatus } from "../_shared/hedra.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";

const FALLBACK_AVATAR_MODEL_ID = "26f0fc66-152b-40ab-abed-76c43df99bc8";

const MOVEMENT_PROMPT: Record<string, string> = {
  none: "static framing, minimal camera motion",
  zoomin: "slow cinematic zoom in",
  zoomout: "slow cinematic zoom out",
  left: "smooth camera pan to the left",
  right: "smooth camera pan to the right",
  up: "smooth camera tilt upward",
};

type NormModel = {
  id: string;
  type: string;
  name: string;
  resolutions: string[];
  aspectRatios: string[];
  requiresAudioInput: boolean;
  requiresStartFrame: boolean;
  maxDurationMs: number | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const sceneId = String(body.sceneId ?? "").trim();
    if (!sceneId) throw new Error("sceneId is required");

    const { data: scene, error: sceneError } = await service
      .from("presenter_video_scenes")
      .select("*")
      .eq("id", sceneId)
      .eq("user_id", user.id)
      .single();
    if (sceneError || !scene) throw new Error("Cena não encontrada");
    if (!scene.hedra_image_asset_id) throw new Error("Defina a imagem da cena antes de gerar o vídeo");

    const speech = String((scene.kind === "fala" ? scene.text : scene.narration) ?? "").trim();
    if (!speech) {
      throw new Error(scene.kind === "fala" ? "Escreva a fala da cena" : "Escreva a narração da cena");
    }

    const { data: project } = await service
      .from("presenter_video_projects")
      .select("voice_id, video_model_id")
      .eq("id", scene.project_id)
      .eq("user_id", user.id)
      .maybeSingle();
    const { data: profile } = await service
      .from("presenter_avatar_profiles")
      .select("hedra_voice_id, selected_voice_id, default_voice_id, hedra_video_model_id")
      .eq("avatar_id", scene.avatar_id)
      .eq("user_id", user.id)
      .maybeSingle();

    const voiceId = readString(project?.voice_id) ??
      readString(profile?.hedra_voice_id) ??
      readString(profile?.selected_voice_id) ??
      readString(profile?.default_voice_id);
    if (!voiceId) throw new Error("Selecione uma voz antes de gerar o vídeo");

    // Resolve a real video model from the live catalog.
    let catalog: NormModel[] = [];
    try {
      const raw = await hedraRequest<unknown>("/models");
      catalog = (Array.isArray(raw) ? raw : []).map(normalizeModel);
    } catch (_e) {
      catalog = [];
    }
    const avatarModels = catalog.filter((m) =>
      m.type === "video" && m.requiresAudioInput && m.requiresStartFrame
    );
    let chosen: NormModel | undefined;
    if (scene.kind === "fala") {
      const wantId = readString(project?.video_model_id) ?? readString(profile?.hedra_video_model_id);
      chosen = avatarModels.find((m) => m.id === wantId) ?? avatarModels[0];
    } else {
      chosen = catalog.find((m) => /omnia/i.test(m.name) && m.type === "video") ?? avatarModels[0];
    }
    const aiModelId = chosen?.id ?? FALLBACK_AVATAR_MODEL_ID;
    const resolution = pickResolution(chosen?.resolutions ?? []);
    const aspectRatio = (chosen?.aspectRatios ?? []).includes("9:16")
      ? "9:16"
      : ((chosen?.aspectRatios ?? [])[0] ?? "9:16");

    // Step 1 — generate the speech audio standalone. Inline audio_generation is
    // rejected by Hedra ("model missing"), but a standalone text_to_speech works.
    const tts = await hedraRequest<Record<string, unknown>>("/generations", {
      body: {
        type: "text_to_speech",
        voice_id: voiceId,
        text: speech,
        language: "Portuguese",
        speed: 1,
        stability: 0.5,
      },
    });
    const ttsGenId = readString(tts.id);
    let audioAssetId = readString(tts.asset_id);
    for (let i = 0; i < 30 && ttsGenId; i += 1) {
      const st = await hedraRequest<Record<string, unknown>>(
        `/generations/${encodeURIComponent(ttsGenId)}/status`,
      );
      audioAssetId = readString(st.asset_id) ?? audioAssetId;
      const mapped = mapHedraGenerationStatus(readString(st.status));
      if (mapped === "completed") break;
      if (mapped === "error") {
        throw new Error(readString(st.error_message) ?? "Falha ao gerar o áudio da fala");
      }
      await sleep(2500);
    }
    if (!audioAssetId) throw new Error("Áudio da fala não foi gerado");

    // Step 2 — generate the video using the ready audio asset.
    const movementPrompt = MOVEMENT_PROMPT[String(scene.camera_movement)] ?? MOVEMENT_PROMPT.none;
    const motionPrompt = scene.kind === "fala"
      ? `A presenter speaking directly to camera with natural facial expression and subtle gestures, ${movementPrompt}.`
      : `${movementPrompt}, subtle natural motion.`;
    const generatedVideoInputs: Record<string, unknown> = {
      text_prompt: motionPrompt,
      aspect_ratio: aspectRatio,
      resolution,
    };
    if (scene.kind === "imagem") {
      const cap = chosen?.maxDurationMs ? Math.floor(chosen.maxDurationMs / 1000) : 8;
      const seconds = Math.min(Math.max(1, Number(scene.duration_s) || 6), Math.max(1, cap), 8);
      generatedVideoInputs.duration_ms = seconds * 1000;
    }

    const generation = await hedraRequest<Record<string, unknown>>("/generations", {
      body: {
        type: "video",
        ai_model_id: aiModelId,
        start_keyframe_id: scene.hedra_image_asset_id,
        audio_id: audioAssetId,
        generated_video_inputs: generatedVideoInputs,
      },
    });

    const generationId = readString(generation.id);
    if (!generationId) throw new Error("Hedra não retornou id de geração");

    const { data: updated, error } = await service
      .from("presenter_video_scenes")
      .update({
        clip_status: "rendering",
        clip_generation_id: generationId,
        error_message: null,
        metadata: {
          ...(scene.metadata ?? {}),
          clip_model_id: aiModelId,
          resolution,
          aspect_ratio: aspectRatio,
          audio_asset_id: audioAssetId,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", scene.id)
      .select("*")
      .single();
    if (error || !updated) throw error ?? new Error("Falha ao salvar render da cena");

    return jsonResponse({ scene: updated, pending: true });
  } catch (error) {
    console.error("render-scene-clip failed:", error instanceof Error ? error.message : error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function pickResolution(resolutions: string[]): string {
  for (const pref of ["720p", "540p", "1080p"]) {
    if (resolutions.includes(pref)) return pref;
  }
  return resolutions[0] ?? "540p";
}

function normalizeModel(raw: unknown): NormModel {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    id: String(o.id ?? ""),
    type: String(o.type ?? ""),
    name: String(o.name ?? ""),
    resolutions: Array.isArray(o.resolutions) ? o.resolutions.map(String) : [],
    aspectRatios: Array.isArray(o.aspect_ratios) ? o.aspect_ratios.map(String) : [],
    requiresAudioInput: o.requires_audio_input === true,
    requiresStartFrame: o.requires_start_frame === true,
    maxDurationMs: typeof o.max_duration_ms === "number" ? o.max_duration_ms : null,
  };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
