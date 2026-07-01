const HEDRA_BASE_URL = "https://api.hedra.com/web-app/public";

type HedraRequestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  method?: string;
};

export type LocalPresenterVideoStatus =
  | "submitted"
  | "processing"
  | "completed"
  | "error";

export type HedraModel = {
  aspectRatios: string[];
  id: string;
  maxDurationMs: number | null;
  name: string;
  requiresAudioInput: boolean;
  requiresStartFrame: boolean;
  resolutions: string[];
  type: string;
  creditCost: number | null;
  unitScale: number | null;
  billingUnit: string | null;
};

export type HedraVoiceOption = {
  gender: string | null;
  language: string | null;
  name: string;
  previewAudioUrl: string | null;
  source: string | null;
  voiceId: string;
};

export type HedraVideoStatus = {
  assetId: string | null;
  durationS: number | null;
  errorMessage: string | null;
  generationId: string;
  progress: number;
  status: LocalPresenterVideoStatus;
  thumbnailUrl: string | null;
  videoUrl: string | null;
};

export async function hedraRequest<T>(
  path: string,
  options: HedraRequestOptions = {},
): Promise<T> {
  const apiKey = Deno.env.get("HEDRA_API_KEY");
  if (!apiKey) {
    throw new Error("Missing HEDRA_API_KEY");
  }

  const response = await fetch(`${HEDRA_BASE_URL}${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: {
      "X-API-Key": apiKey,
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: options.body instanceof FormData
      ? options.body
      : options.body
        ? JSON.stringify(options.body)
        : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const obj = readObject(payload);
    // FastAPI validation errors come as an array of { loc, msg } — flatten them so
    // the actual missing/invalid field surfaces instead of a bare "Field required".
    const detail = obj.detail;
    const detailMsg = Array.isArray(detail)
      ? detail.map((d) => {
        const o = readObject(d);
        const loc = Array.isArray(o.loc) ? o.loc.join(".") : "";
        return [loc, readOptionalString(o.msg)].filter(Boolean).join(": ");
      }).filter(Boolean).join("; ") || null
      : readOptionalString(detail);
    const message = readOptionalString(obj.error_message) ?? detailMsg ?? text;
    throw new Error(`Hedra ${response.status}: ${message}`);
  }

  return payload as T;
}

export async function createHedraAsset({
  name,
  type,
}: {
  name: string;
  type: "audio" | "image" | "video";
}) {
  return await hedraRequest<{ id: string }>("/assets", {
    body: { name, type },
  });
}

export async function uploadHedraAsset({
  assetId,
  bytes,
  filename,
  type,
}: {
  assetId: string;
  bytes: ArrayBuffer;
  filename: string;
  type: string;
}) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), filename);
  return await hedraRequest<unknown>(`/assets/${encodeURIComponent(assetId)}/upload`, {
    body: form,
  });
}

export function normalizeHedraModels(rawModels: unknown) {
  const models = Array.isArray(rawModels)
    ? rawModels.map(normalizeModel).filter((model): model is HedraModel => Boolean(model))
    : [];

  // Return every video model (not just the audio-driven avatar ones). The client
  // splits them by capability: lip-sync/talking = requiresAudioInput (used by the
  // "fala" mode), motion/image-to-video = requiresStartFrame (used by "imagem").
  return {
    image: models.filter((model) => model.type === "image"),
    video: models.filter((model) => model.type === "video"),
  };
}

export function normalizeHedraVoices(rawVoices: unknown): HedraVoiceOption[] {
  if (!Array.isArray(rawVoices)) return [];

  return rawVoices.flatMap((rawVoice) => {
    const voice = readObject(rawVoice);
    const voiceId = readOptionalString(voice.id);
    if (!voiceId) return [];

    const asset = readObject(voice.asset);
    const labels = Array.isArray(asset.labels) ? asset.labels.map(readObject) : [];
    const findLabel = (name: string) =>
      readOptionalString(labels.find((label) => label.name === name)?.value);

    return [{
      gender: findLabel("gender"),
      language: findLabel("language"),
      name: readOptionalString(voice.name) ?? voiceId,
      previewAudioUrl: readOptionalString(asset.preview_url),
      source: readOptionalString(asset.source),
      voiceId,
    }];
  });
}

export function normalizeHedraVideoStatus(response: unknown): HedraVideoStatus {
  const payload = readObject(response);
  const generationId = readRequiredString(payload.id, "Hedra status response is missing id");
  const assetId = readOptionalString(payload.asset_id);
  const rawProgress = typeof payload.progress === "number" && Number.isFinite(payload.progress)
    ? payload.progress
    : 0;
  const videoUrl = readOptionalString(payload.download_url) ?? readOptionalString(payload.url) ??
    readOptionalString(payload.streaming_url);

  return {
    assetId,
    durationS: null,
    errorMessage: readOptionalString(payload.error_message),
    generationId,
    progress: rawProgress,
    status: mapHedraGenerationStatus(readOptionalString(payload.status)),
    thumbnailUrl: readOptionalString(payload.thumbnail_url) ?? readOptionalString(payload.poster_url),
    videoUrl,
  };
}

export function mapHedraGenerationStatus(status: string | null | undefined): LocalPresenterVideoStatus {
  if (status === "complete") return "completed";
  if (status === "error") return "error";
  if (status === "processing" || status === "finalizing") return "processing";
  return "submitted";
}

function normalizeModel(rawModel: unknown): HedraModel | null {
  const model = readObject(rawModel);
  const id = readOptionalString(model.id);
  const type = readOptionalString(model.type);
  if (!id || !type) return null;

  const price = readObject(model.price_details);

  return {
    aspectRatios: readStringArray(model.aspect_ratios),
    id,
    maxDurationMs: typeof model.max_duration_ms === "number" && Number.isFinite(model.max_duration_ms)
      ? model.max_duration_ms
      : null,
    name: readOptionalString(model.name) ?? id,
    requiresAudioInput: model.requires_audio_input === true,
    requiresStartFrame: model.requires_start_frame === true,
    resolutions: readStringArray(model.resolutions),
    type,
    creditCost: typeof price.credit_cost === "number" && Number.isFinite(price.credit_cost)
      ? price.credit_cost
      : null,
    unitScale: typeof price.unit_scale === "number" && Number.isFinite(price.unit_scale)
      ? price.unit_scale
      : null,
    billingUnit: readOptionalString(price.billing_unit),
  };
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
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
