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
  // Worker fora do ar ou reiniciando. "failed to dispatch" nunca cobriu esses casos:
  // é só o fallback de quando o erro não é um Error, e o fetch do Deno lança TypeError
  // (que é Error), então a mensagem gravada era a string crua do cliente Rust.
  "worker_unreachable",
  "connection refused",
  "error sending request",
  "tcp connect",
  "econnrefused",
];

// Job que entrou em "processing" e nunca saiu. Acontece quando o worker morre no meio do
// render (o OOM killer manda SIGKILL, então o catch que gravaria o erro nunca roda) — o
// job fica órfão e a UI mostra "Renderizando" para sempre. Folgado o bastante para não
// pegar job legitimamente na fila do worker.
const STUCK_PROCESSING_MINUTES = 45;

// Job recusado pelo 503 do worker volta para "pending" e ninguém mais o dispara, porque o
// scan automático só olha status = 'error'. Isso era coberto por um cron que drenava a
// pgmq, mas a fila guardava uma mensagem órfã por job já criado desde junho — drená-la
// republicou cerca de 180 posts em 28/07. Varrer por status nunca ressuscita conteúdo
// antigo: um job publicado não está em "pending".
const STALE_PENDING_MINUTES = 10;

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

    // Antes de varrer os erros: solta os jobs órfãos em "processing" marcando-os como
    // error. Assim eles caem no scan normal na próxima passada e herdam backoff e cap
    // de retentativas, em vez de precisarem de um caminho paralelo só para eles.
    const reaped = await reapStuckProcessing(service);
    const redispatched = await redispatchStalePending(service);

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

    return jsonResponse({ retried, scanned: jobs?.length ?? 0, reaped, redispatched });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

async function redispatchStalePending(service: ServiceClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60_000).toISOString();
  const { data: stale, error } = await service
    .from("reel_jobs")
    .select("id")
    .eq("status", "pending")
    .lt("updated_at", cutoff)
    .limit(20);
  if (error) throw error;

  for (const job of stale ?? []) {
    // Sem mexer em retry_count nem em last_retried_at: backpressure não é falha do job, e
    // queimar retentativa aqui mataria um job só por o worker estar ocupado. O reel-processor
    // reivindica o job antes de despachar, então uma segunda passada não duplica nada.
    EdgeRuntime.waitUntil(triggerProcessor(job.id as string));
  }
  return stale?.length ?? 0;
}

async function reapStuckProcessing(service: ServiceClient): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_MINUTES * 60_000).toISOString();
  const { data: stuck, error } = await service
    .from("reel_jobs")
    .select("id")
    .eq("status", "processing")
    .lt("updated_at", cutoff)
    .limit(50);
  if (error) throw error;

  let reaped = 0;
  for (const job of stuck ?? []) {
    // O filtro de status repetido no update evita corrida com o worker terminando o
    // render entre o select e o update — nesse caso o job já saiu de processing e não
    // queremos sobrescrever o resultado dele.
    const { error: updateError } = await service
      .from("reel_jobs")
      .update({
        status: "error",
        error_message:
          `worker_unreachable: job travado em processing por mais de ${STUCK_PROCESSING_MINUTES}min `
          + "(worker provavelmente morreu durante o render)",
      })
      .eq("id", job.id as string)
      .eq("status", "processing");
    if (!updateError) reaped++;
  }
  return reaped;
}

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
