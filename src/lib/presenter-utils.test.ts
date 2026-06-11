import { describe, expect, test } from "bun:test";

import {
  extractHeyGenAvatarProfile,
  extractHeyGenVideoStatus,
  normalizeHeyGenVoiceOptions,
} from "./presenter-utils";

describe("extractHeyGenAvatarProfile", () => {
  test("extracts the persistent group, look and default voice from a HeyGen avatar response", () => {
    const profile = extractHeyGenAvatarProfile({
      data: {
        avatar_item: {
          id: "look_123",
          preview_image_url: "https://files.heygen.ai/look.jpg",
          preview_video_url: "https://files.heygen.ai/look.mp4",
        },
        avatar_group: {
          id: "ag_123",
          default_voice_id: "voice_default",
          preview_image_url: "https://files.heygen.ai/group.jpg",
          preview_video_url: "https://files.heygen.ai/group.mp4",
        },
      },
    });

    expect(profile).toEqual({
      defaultVoiceId: "voice_default",
      groupId: "ag_123",
      lookId: "look_123",
      previewImageUrl: "https://files.heygen.ai/look.jpg",
      previewVideoUrl: "https://files.heygen.ai/look.mp4",
    });
  });
});

describe("normalizeHeyGenVoiceOptions", () => {
  test("keeps voice options with ids and preview URLs", () => {
    const voices = normalizeHeyGenVoiceOptions({
      data: {
        voices: [
          {
            voice_id: "voice_1",
            name: "Clara",
            language: "Portuguese",
            gender: "female",
            preview_audio_url: "https://files.heygen.ai/clara.mp3",
          },
          { name: "Sem id" },
        ],
        seed: 456,
      },
    });

    expect(voices).toEqual([
      {
        gender: "female",
        language: "Portuguese",
        name: "Clara",
        previewAudioUrl: "https://files.heygen.ai/clara.mp3",
        seed: 456,
        voiceId: "voice_1",
      },
    ]);
  });
});

describe("extractHeyGenVideoStatus", () => {
  test("maps a completed HeyGen video to local project fields", () => {
    const status = extractHeyGenVideoStatus({
      data: {
        id: "video_123",
        status: "completed",
        video_url: "https://files.heygen.ai/video.mp4",
        thumbnail_url: "https://files.heygen.ai/thumb.jpg",
        duration: 30.5,
      },
    });

    expect(status).toEqual({
      durationS: 30.5,
      errorMessage: null,
      status: "completed",
      thumbnailUrl: "https://files.heygen.ai/thumb.jpg",
      videoId: "video_123",
      videoUrl: "https://files.heygen.ai/video.mp4",
    });
  });

  test("maps HeyGen failure details to an error status", () => {
    const status = extractHeyGenVideoStatus({
      data: {
        id: "video_123",
        status: "failed",
        failure_code: "rendering_failed",
        failure_message: "Avatar rendering timed out",
      },
    });

    expect(status.status).toBe("error");
    expect(status.errorMessage).toBe("rendering_failed: Avatar rendering timed out");
  });
});
