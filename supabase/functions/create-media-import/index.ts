import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";
import { readWorkerError } from "../_shared/worker.ts";

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const body = await request.json();
    const type = String(body.type ?? "");
    const input = normalizeInput(type, String(body.input ?? ""));
    const requestedLimit = normalizeLimit(body.limit);

    const service = createServiceClient();
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);
    const { data: mediaImport, error } = await service
      .from("media_imports")
      .insert({
        user_id: user.id,
        avatar_id: avatar.id,
        type,
        input,
        requested_limit: requestedLimit,
      })
      .select("id")
      .single();

    if (error || !mediaImport) throw error ?? new Error("Failed to create import");
    EdgeRuntime.waitUntil(dispatchImport(mediaImport.id));

    return jsonResponse({ importId: mediaImport.id, status: "pending" });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function normalizeInput(type: string, rawInput: string) {
  const input = rawInput.trim();
  if (type === "url") {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid URL");
    return url.toString();
  }

  if (type === "instagram_profile") {
    const username = input.replace(/^@/, "").trim();
    if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) {
      throw new Error("Invalid Instagram username");
    }
    return username.toLowerCase();
  }

  throw new Error("Invalid import type");
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(50, Math.trunc(parsed)));
}

async function dispatchImport(importId: string) {
  const service = createServiceClient();
  const workerUrl = Deno.env.get("VIDEO_WORKER_URL");
  const workerSecret = Deno.env.get("VIDEO_WORKER_SECRET");

  if (!workerUrl) {
    await service.from("media_imports").update({
      status: "error",
      error_message: "VIDEO_WORKER_URL is not configured",
      completed_at: new Date().toISOString(),
    }).eq("id", importId);
    return;
  }

  try {
    const response = await fetch(
      `${workerUrl.replace(/\/$/, "")}/process-media-import`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {}),
        },
        body: JSON.stringify({ importId }),
      },
    );

    if (!response.ok) throw new Error(await readWorkerError(response));
  } catch (error) {
    await markImportFailed(
      service,
      importId,
      error instanceof Error ? error.message : "Worker dispatch failed",
    );
  }
}

/**
 * The worker records a detailed error on the row *before* it answers with a
 * 500, so overwriting it here would replace a useful message ("rebuild the
 * worker with curl-cffi") with the transport-level one. Only fill in when the
 * import never reached a terminal state — i.e. the worker never got that far.
 */
async function markImportFailed(
  service: ReturnType<typeof createServiceClient>,
  importId: string,
  message: string,
) {
  const { data } = await service
    .from("media_imports")
    .select("status")
    .eq("id", importId)
    .maybeSingle();

  const status = data?.status as string | undefined;
  if (status === "error" || status === "partial" || status === "completed") return;

  await service.from("media_imports").update({
    status: "error",
    error_message: message,
    completed_at: new Date().toISOString(),
  }).eq("id", importId);
}
