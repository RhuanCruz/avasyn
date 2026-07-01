import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { hedraRequest, mapHedraGenerationStatus } from "../_shared/hedra.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
} from "../_shared/supabase.ts";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

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

    // Terminal / in-flight states short-circuit so we don't re-hit Hedra or
    // overwrite a muxed clip with the raw (silent) motion URL.
    if (scene.clip_status === "ready") return jsonResponse({ scene });
    if (scene.clip_status === "error") return jsonResponse({ scene });
    if (scene.clip_status === "assembling") return jsonResponse({ scene, pending: true });

    const generationId = readString(scene.clip_generation_id);
    if (!generationId) throw new Error("Cena não tem render Hedra");

    const status = await hedraRequest<Record<string, unknown>>(
      `/generations/${encodeURIComponent(generationId)}/status`,
    );
    const mapped = mapHedraGenerationStatus(readString(status.status));

    if (mapped === "error") {
      const { data: updated } = await service
        .from("presenter_video_scenes")
        .update({
          clip_status: "error",
          error_message: readString(status.error_message) ?? "Falha no render do vídeo",
          updated_at: new Date().toISOString(),
        })
        .eq("id", scene.id)
        .select("*")
        .single();
      return jsonResponse({ scene: updated ?? scene });
    }

    if (mapped !== "completed") {
      return jsonResponse({ scene, pending: true });
    }

    // Resolve the motion/talking video URL from the generation (or its asset).
    const assetId = readString(status.asset_id);
    let videoUrl = readString(status.download_url) ??
      readString(status.url) ??
      readString(status.streaming_url);
    let thumbnailUrl = readString(status.thumbnail_url) ?? readString(status.poster_url);
    if (!videoUrl && assetId) {
      const fetched = await fetchAssetUrl("video", assetId);
      if (fetched) {
        videoUrl = fetched.url ?? videoUrl;
        thumbnailUrl = thumbnailUrl ?? fetched.thumbnailUrl;
      }
    }

    const meta = (scene.metadata ?? {}) as Record<string, unknown>;
    const needsMux = meta.needs_mux === true;

    // Narração: the motion clip is silent — mux the narration audio onto it in the worker.
    if (needsMux) {
      if (meta.mux_dispatched === true) {
        return jsonResponse({ scene, pending: true });
      }
      const narrationAudioAssetId = readString(meta.narration_audio_asset_id);
      const audioFetched = narrationAudioAssetId ? await fetchAssetUrl("audio", narrationAudioAssetId) : null;
      const audioUrl = audioFetched?.url ?? null;
      if (!videoUrl || !audioUrl) {
        // URLs not ready yet — retry next poll.
        return jsonResponse({ scene, pending: true });
      }

      const { data: updated } = await service
        .from("presenter_video_scenes")
        .update({
          clip_status: "assembling",
          clip_thumbnail_url: thumbnailUrl,
          error_message: null,
          metadata: { ...meta, mux_dispatched: true },
          updated_at: new Date().toISOString(),
        })
        .eq("id", scene.id)
        .select("*")
        .single();

      EdgeRuntime.waitUntil(dispatchWorkerMux(service, scene.id, scene.user_id, videoUrl, audioUrl));
      return jsonResponse({ scene: updated ?? scene, pending: true });
    }

    // Fala (or any audio-embedded clip): mark ready with the Hedra URL directly.
    const { data: updated, error } = await service
      .from("presenter_video_scenes")
      .update({
        clip_status: "ready",
        clip_url: videoUrl,
        clip_thumbnail_url: thumbnailUrl,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", scene.id)
      .select("*")
      .single();
    if (error || !updated) throw error ?? new Error("Falha ao atualizar cena");

    return jsonResponse({ scene: updated });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

// Dispatch the ffmpeg mux (motion video + narration audio) to the video worker.
// The worker updates the scene row to ready (with clip_path/clip_bucket) or error.
async function dispatchWorkerMux(
  service: ReturnType<typeof createServiceClient>,
  sceneId: string,
  userId: string,
  videoUrl: string,
  audioUrl: string,
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
      body: JSON.stringify({ sceneId, userId, videoUrl, audioUrl }),
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
      .eq("id", sceneId);
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

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
