import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { hedraRequest, mapHedraGenerationStatus } from "../_shared/hedra.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

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

    const isNarration = scene.kind === "imagem";
    // Narração default = still image + Ken Burns (no generative video, so the person
    // never moves/talks). "ai" opts into a generative motion model (may animate faces).
    const motionSource = isNarration
      ? (readString((scene.metadata as Record<string, unknown> | null)?.motion_source) ?? "kenburns")
      : "video";

    const { data: project } = await service
      .from("presenter_video_projects")
      .select("voice_id, video_model_id, motion_model_id")
      .eq("id", scene.project_id)
      .eq("user_id", user.id)
      .maybeSingle();
    const { data: profile } = await service
      .from("presenter_avatar_profiles")
      .select("hedra_voice_id, selected_voice_id, default_voice_id, hedra_video_model_id")
      .eq("avatar_id", scene.avatar_id)
      .eq("user_id", user.id)
      .maybeSingle();

    // Fala uses the project voice; narração uses the per-scene narration voice.
    const voiceId = isNarration
      ? (readString(scene.narration_voice_id) ??
        readString(project?.voice_id) ??
        readString(profile?.hedra_voice_id) ??
        readString(profile?.selected_voice_id) ??
        readString(profile?.default_voice_id))
      : (readString(project?.voice_id) ??
        readString(profile?.hedra_voice_id) ??
        readString(profile?.selected_voice_id) ??
        readString(profile?.default_voice_id));
    if (!voiceId) {
      throw new Error(isNarration ? "Selecione a voz da narração" : "Selecione uma voz antes de gerar o vídeo");
    }

    // Step 1 — generate the speech/narration audio standalone (Hedra TTS). Inline
    // audio_generation is rejected, but a standalone text_to_speech works.
    const audioAssetId = await generateTts(voiceId, speech);

    // ── Narração / Ken Burns: no generative video. Build the clip from the still
    //    image + the narration audio in the worker. The character never moves/talks.
    if (isNarration && motionSource === "kenburns") {
      const imageUrl = (await fetchAssetUrl("image", scene.hedra_image_asset_id))?.url ??
        readString((scene.metadata as Record<string, unknown> | null)?.preview_url);
      const audioUrl = (await fetchAssetUrl("audio", audioAssetId))?.url ?? null;
      if (!imageUrl) throw new Error("Não foi possível resolver a imagem da cena");
      if (!audioUrl) throw new Error("Não foi possível resolver o áudio da narração");

      const { data: updated, error } = await service
        .from("presenter_video_scenes")
        .update({
          clip_status: "assembling",
          clip_generation_id: null,
          error_message: null,
          metadata: {
            ...(scene.metadata ?? {}),
            mode: "kenburns",
            narration_audio_asset_id: audioAssetId,
            needs_mux: true,
            mux_dispatched: true,
            clip_path: null,
            clip_bucket: null,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", scene.id)
        .select("*")
        .single();
      if (error || !updated) throw error ?? new Error("Falha ao salvar render da cena");

      EdgeRuntime.waitUntil(dispatchWorker(service, {
        sceneId: scene.id,
        userId: scene.user_id,
        imageUrl,
        audioUrl,
      }));
      return jsonResponse({ scene: updated, pending: true });
    }

    // ── Fala (lip-sync) or narração "movimento IA": generate a Hedra video.
    let catalog: NormModel[] = [];
    try {
      const raw = await hedraRequest<unknown>("/models");
      catalog = (Array.isArray(raw) ? raw : []).map(normalizeModel);
    } catch (_e) {
      catalog = [];
    }
    const talkingModels = catalog.filter((m) =>
      m.type === "video" && m.requiresAudioInput && m.requiresStartFrame
    );
    const motionModels = catalog.filter((m) =>
      m.type === "video" && m.requiresStartFrame && !m.requiresAudioInput
    );
    let chosen: NormModel | undefined;
    if (!isNarration) {
      const wantId = readString(project?.video_model_id) ?? readString(profile?.hedra_video_model_id);
      chosen = talkingModels.find((m) => m.id === wantId) ?? talkingModels[0];
    } else {
      // Narração "IA": only pure motion models — never fall back to a talking model
      // (that would lip-sync the narration onto the person).
      const wantId = readString(project?.motion_model_id);
      chosen = motionModels.find((m) => m.id === wantId) ?? motionModels[0];
      if (!chosen) {
        throw new Error("Nenhum modelo de movimento disponível. Use o modo Imagem (Ken Burns).");
      }
    }
    const aiModelId = chosen?.id ?? FALLBACK_AVATAR_MODEL_ID;

    // Only fala embeds audio (lip-sync). Narração never passes audio to the video —
    // its voice-over is muxed in the worker, so the person never lip-syncs.
    const embedAudio = !isNarration && chosen?.requiresAudioInput === true;
    const needsMux = isNarration; // narração "IA" clips are silent → muxed afterwards
    const resolution = pickResolution(chosen?.resolutions ?? []);
    const aspectRatio = (chosen?.aspectRatios ?? []).includes("9:16")
      ? "9:16"
      : ((chosen?.aspectRatios ?? [])[0] ?? "9:16");

    const movementPrompt = MOVEMENT_PROMPT[String(scene.camera_movement)] ?? MOVEMENT_PROMPT.none;
    const actionPrompt = readString(scene.action_prompt);
    const base = scene.kind === "fala"
      ? "A presenter speaking directly to camera with natural facial expression and subtle gestures"
      : "Subtle natural motion, do not change the subject's mouth";
    const motionPrompt = [base, actionPrompt, movementPrompt].filter(Boolean).join(", ") + ".";
    const generatedVideoInputs: Record<string, unknown> = {
      text_prompt: motionPrompt,
      aspect_ratio: aspectRatio,
      resolution,
    };
    if (isNarration) {
      const cap = chosen?.maxDurationMs ? Math.floor(chosen.maxDurationMs / 1000) : 8;
      const seconds = Math.min(Math.max(1, Number(scene.duration_s) || 6), Math.max(1, cap), 8);
      generatedVideoInputs.duration_ms = seconds * 1000;
    }

    const generation = await hedraRequest<Record<string, unknown>>("/generations", {
      body: {
        type: "video",
        ai_model_id: aiModelId,
        start_keyframe_id: scene.hedra_image_asset_id,
        ...(embedAudio && audioAssetId ? { audio_id: audioAssetId } : {}),
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
          mode: isNarration ? "ai" : "fala",
          clip_model_id: aiModelId,
          resolution,
          aspect_ratio: aspectRatio,
          audio_asset_id: audioAssetId,
          narration_audio_asset_id: needsMux ? audioAssetId : null,
          needs_mux: needsMux,
          mux_dispatched: false,
          clip_path: null,
          clip_bucket: null,
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

async function generateTts(voiceId: string, speech: string): Promise<string> {
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
      throw new Error(readString(st.error_message) ?? "Falha ao gerar o áudio");
    }
    await sleep(2500);
  }
  if (!audioAssetId) throw new Error("Áudio não foi gerado");
  return audioAssetId;
}

// Dispatch the Ken Burns assembly (still image + narration audio) to the worker.
async function dispatchWorker(
  service: ReturnType<typeof createServiceClient>,
  payload: { sceneId: string; userId: string; imageUrl: string; audioUrl: string },
) {
  try {
    const workerUrl = Deno.env.get("VIDEO_WORKER_URL");
    const workerSecret = Deno.env.get("VIDEO_WORKER_SECRET");
    if (!workerUrl) throw new Error("VIDEO_WORKER_URL não configurado");
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/assemble-scene-clip`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`assemble-scene-clip: ${await response.text()}`);
  } catch (error) {
    await service
      .from("presenter_video_scenes")
      .update({
        clip_status: "error",
        error_message: error instanceof Error ? error.message : "Falha ao montar a narração",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.sceneId);
  }
}

async function fetchAssetUrl(
  type: "image" | "video" | "audio",
  assetId: string,
): Promise<{ url: string | null; thumbnailUrl: string | null } | null> {
  try {
    const res = await hedraRequest<unknown>(`/assets?type=${type}&ids=${encodeURIComponent(assetId)}`);
    const list = Array.isArray(res)
      ? res
      : (Array.isArray((res as Record<string, unknown>)?.assets) ? (res as Record<string, unknown>).assets as unknown[] : []);
    const first = (list[0] ?? null) as Record<string, unknown> | null;
    if (!first) return null;
    const inner = (first.asset ?? {}) as Record<string, unknown>;
    return {
      url: readString(inner.download_url) ?? readString(inner.url),
      thumbnailUrl: readString(first.thumbnail_url),
    };
  } catch {
    return null;
  }
}

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
