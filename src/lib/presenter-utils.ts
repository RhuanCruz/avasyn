import type { PresenterVideoStatus } from "./types";

export type HeyGenAvatarProfile = {
  defaultVoiceId: string | null;
  groupId: string;
  lookId: string;
  previewImageUrl: string | null;
  previewVideoUrl: string | null;
};

export type HeyGenVoiceOption = {
  gender: string | null;
  language: string | null;
  name: string;
  previewAudioUrl: string | null;
  seed: number | null;
  voiceId: string;
};

export type HeyGenVideoStatus = {
  durationS: number | null;
  errorMessage: string | null;
  status: PresenterVideoStatus;
  thumbnailUrl: string | null;
  videoId: string;
  videoUrl: string | null;
};

export function extractHeyGenAvatarProfile(response: unknown): HeyGenAvatarProfile {
  const data = readObject(readObject(response).data);
  const item = readObject(data.avatar_item);
  const group = readObject(data.avatar_group);
  const lookId = readRequiredString(item.id, "HeyGen avatar response is missing avatar_item.id");
  const groupId = readRequiredString(group.id, "HeyGen avatar response is missing avatar_group.id");

  return {
    defaultVoiceId: readOptionalString(group.default_voice_id),
    groupId,
    lookId,
    previewImageUrl: readOptionalString(item.preview_image_url) ?? readOptionalString(group.preview_image_url),
    previewVideoUrl: readOptionalString(item.preview_video_url) ?? readOptionalString(group.preview_video_url),
  };
}

export function normalizeHeyGenVoiceOptions(response: unknown): HeyGenVoiceOption[] {
  const data = readObject(readObject(response).data);
  const rawVoices = Array.isArray(data.voices)
    ? data.voices
    : Array.isArray(data.data)
      ? data.data
      : [];
  const seed = typeof data.seed === "number" && Number.isFinite(data.seed) ? data.seed : null;

  return rawVoices.flatMap((rawVoice) => {
    const voice = readObject(rawVoice);
    const voiceId = readOptionalString(voice.voice_id);
    if (!voiceId) return [];

    return [{
      gender: readOptionalString(voice.gender),
      language: readOptionalString(voice.language),
      name: readOptionalString(voice.name) ?? voiceId,
      previewAudioUrl: readOptionalString(voice.preview_audio_url),
      seed,
      voiceId,
    }];
  });
}

export function extractHeyGenVideoStatus(response: unknown): HeyGenVideoStatus {
  const data = readObject(readObject(response).data);
  const videoId = readRequiredString(data.id, "HeyGen video response is missing data.id");
  const rawStatus = readOptionalString(data.status);
  const failureCode = readOptionalString(data.failure_code);
  const failureMessage = readOptionalString(data.failure_message);
  const errorMessage = [failureCode, failureMessage].filter(Boolean).join(": ") || null;

  return {
    durationS: typeof data.duration === "number" && Number.isFinite(data.duration) ? data.duration : null,
    errorMessage,
    status: mapHeyGenVideoStatus(rawStatus, errorMessage),
    thumbnailUrl: readOptionalString(data.thumbnail_url),
    videoId,
    videoUrl: readOptionalString(data.video_url),
  };
}

export function mapHeyGenVideoStatus(
  status: string | null | undefined,
  errorMessage: string | null = null,
): PresenterVideoStatus {
  if (errorMessage || status === "failed") return "error";
  if (status === "completed") return "completed";
  if (status === "processing" || status === "pending" || status === "generating") {
    return "processing";
  }
  return "submitted";
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readRequiredString(value: unknown, message: string): string {
  const result = readOptionalString(value);
  if (!result) throw new Error(message);
  return result;
}
