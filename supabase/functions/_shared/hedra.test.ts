import { describe, expect, test } from "bun:test";

import {
  mapHedraGenerationStatus,
  normalizeHedraModels,
  normalizeHedraVideoStatus,
  normalizeHedraVoices,
} from "./hedra";

describe("Hedra shared helpers", () => {
  test("normalizes image and avatar-capable video models", () => {
    const models = normalizeHedraModels([
      {
        id: "image-model",
        name: "Image Model",
        type: "image",
        aspect_ratios: ["9:16"],
        resolutions: ["720p"],
      },
      {
        id: "video-model",
        name: "Avatar Model",
        type: "video",
        requires_start_frame: true,
        requires_audio_input: true,
        max_duration_ms: 600000,
      },
      {
        id: "text-model",
        name: "Text Model",
        type: "text",
      },
    ]);

    expect(models.image.map((model) => model.id)).toEqual(["image-model"]);
    expect(models.video.map((model) => model.id)).toEqual(["video-model"]);
    expect(models.video[0].maxDurationMs).toBe(600000);
  });

  test("normalizes voices with preview and labels", () => {
    const voices = normalizeHedraVoices([
      {
        id: "voice-id",
        name: "Ana",
        asset: {
          type: "voice",
          preview_url: "https://example.com/ana.mp3",
          labels: [
            { name: "language", value: "Portuguese" },
            { name: "gender", value: "female" },
          ],
        },
      },
      { id: null, name: "Invalid" },
    ]);

    expect(voices).toEqual([
      {
        gender: "female",
        language: "Portuguese",
        name: "Ana",
        previewAudioUrl: "https://example.com/ana.mp3",
        source: null,
        voiceId: "voice-id",
      },
    ]);
  });

  test("maps generation status to local presenter status", () => {
    expect(mapHedraGenerationStatus("queued")).toBe("submitted");
    expect(mapHedraGenerationStatus("finalizing")).toBe("processing");
    expect(mapHedraGenerationStatus("processing")).toBe("processing");
    expect(mapHedraGenerationStatus("complete")).toBe("completed");
    expect(mapHedraGenerationStatus("error")).toBe("error");
  });

  test("extracts video status fields from Hedra status response", () => {
    const status = normalizeHedraVideoStatus({
      id: "generation-id",
      asset_id: "asset-id",
      status: "complete",
      progress: 1,
      download_url: "https://example.com/video.mp4",
      url: "https://example.com/stream.mp4",
    });

    expect(status).toEqual({
      assetId: "asset-id",
      durationS: null,
      errorMessage: null,
      generationId: "generation-id",
      progress: 1,
      status: "completed",
      thumbnailUrl: null,
      videoUrl: "https://example.com/video.mp4",
    });
  });
});
