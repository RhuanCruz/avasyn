import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

type ServiceClient = ReturnType<typeof createServiceClient>;

const MAX_RETRIES = 5;

// Substrings (case-insensitive) that identify transient download/auth failures
// worth retrying — e.g. expired YouTube cookies, bot-gating, rate limits, worker hiccups.
const RETRYABLE_PATTERNS = [
  "cookies",
  "not a bot",
  "sign in to confirm",
  "yt-dlp",
  "http error 429",
  "too many requests",
  "failed to dispatch",
  "timed out",
  "timeout",
  "temporarily",
];

// Exponential backoff in minutes by retry_count: 15, 30, 60, 120, 240 (capped).
function backoffMinutes(retryCount: number): number {
  return Math.min(240, 15 * Math.pow(2, retryCount));
}

function isEligible(lastRetriedAt: string | null, retryCount: number): boolean {
  if (!lastRetriedAt) return true;
  const elapsedMin = (Date.now() - Date.parse(lastRetriedAt)) / 60000;
  return elapsedMin >= backoffMinutes(retryCount);
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const service = createServiceClient();
    const body = await request.json().catch(() => ({}));
    const jobId = typeof body.jobId === "string" ? body.jobId : null;

    // Manual single retry (from the UI) — bypasses backoff.
    if (jobId) {
      const { data: job, error } = await service
        .from("reel_jobs")
        .select("id, status, retry_count")
        .eq("id", jobId)
        .single();
      if (error || !job) throw new Error("Job não encontrado");
      await retryJob(service, job.id as string, (job.retry_count as number) ?? 0);
      return jsonResponse({ retried: 1 });
    }

    // Automatic scan: retryable failures, capped retries.
    const orFilter = RETRYABLE_PATTERNS.map((p) => `error_message.ilike.%${p}%`).join(",");
    const { data: jobs, error } = await service
      .from("reel_jobs")
      .select("id, error_message, retry_count, last_retried_at")
      .eq("status", "error")
      .lt("retry_count", MAX_RETRIES)
      .or(orFilter)
      .limit(50);
    if (error) throw error;

    let retried = 0;
    for (const job of jobs ?? []) {
      const retryCount = (job.retry_count as number) ?? 0;
      if (!isEligible(job.last_retried_at as string | null, retryCount)) continue;
      await retryJob(service, job.id as string, retryCount);
      retried++;
    }

    return jsonResponse({ retried, scanned: jobs?.length ?? 0 });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

async function retryJob(service: ServiceClient, jobId: string, retryCount: number) {
  await service
    .from("reel_jobs")
    .update({
      status: "pending",
      error_message: null,
      retry_count: retryCount + 1,
      last_retried_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  const { error: enqueueError } = await service.rpc("enqueue_reel_job", { job_id: jobId });
  if (enqueueError) throw enqueueError;

  EdgeRuntime.waitUntil(triggerProcessor(jobId));
}

async function triggerProcessor(jobId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;
  await fetch(`${supabaseUrl}/functions/v1/reel-processor`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobId }),
  });
}
