import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";
import { readWorkerError } from "../_shared/worker.ts";

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

type ServiceClient = ReturnType<typeof createServiceClient>;

type QueueMessage = {
  msg_id: number;
  message: {
    job_id: string;
  };
};

// Só estes dois estados podem ser reivindicados. "processing" já tem alguém trabalhando;
// "rendered", "posting" e "posted" já passaram do render, e reprocessá-los publicaria o
// mesmo vídeo outra vez.
const CLAIMABLE_STATUSES = ["pending", "error"];

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const service = createServiceClient();
    const body = await request.json().catch(() => ({}));
    if (body.jobId) {
      const jobId = String(body.jobId);
      await assertCanProcessJob(request, jobId);
      if (!(await claimJob(service, jobId))) {
        return jsonResponse({
          skipped: true,
          jobId,
          reason: "Job já foi processado ou está em andamento",
        });
      }
      EdgeRuntime.waitUntil(dispatchToWorker(jobId, null));
      return jsonResponse({ accepted: true, jobId });
    }

    const { data: messages, error } = await service.rpc("read_reel_job_messages", {
      qty: 1,
    });

    if (error) throw error;
    const message = (messages as QueueMessage[] | null)?.[0];
    if (!message) return jsonResponse({ processed: 0 });

    const jobId = message.message.job_id;
    if (!(await claimJob(service, jobId))) {
      // Mensagem órfã de um job que já foi processado por outro caminho. Descartar aqui é
      // o que impede a fila de republicar conteúdo antigo.
      await service.rpc("delete_reel_job_message", { msg_id: message.msg_id });
      return jsonResponse({ skipped: true, jobId, reason: "Mensagem obsoleta descartada" });
    }

    EdgeRuntime.waitUntil(dispatchToWorker(jobId, message.msg_id));
    return jsonResponse({ accepted: true, jobId });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

async function assertCanProcessJob(request: Request, jobId: string) {
  const authorization = request.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey && authorization === `Bearer ${serviceRoleKey}`) {
    return;
  }

  const user = await getAuthenticatedUser(request);
  const service = createServiceClient();
  const { data: job, error } = await service
    .from("reel_jobs")
    .select("user_id")
    .eq("id", jobId)
    .single();

  if (error || !job || job.user_id !== user.id) {
    throw new Error("Job not found");
  }
}

// Reivindica o job de forma atômica: o UPDATE condicional garante que só um chamador
// consiga mover pending/error para processing. Todos os caminhos de criação enfileiram na
// pgmq E chamam o reel-processor direto com o jobId, então sem esta trava o mesmo job era
// renderizado e publicado duas vezes.
async function claimJob(service: ServiceClient, jobId: string) {
  const { data, error } = await service
    .from("reel_jobs")
    .update({ status: "processing", error_message: null })
    .eq("id", jobId)
    .in("status", CLAIMABLE_STATUSES)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function dispatchToWorker(jobId: string, msgId: number | null) {
  const service = createServiceClient();
  const workerUrl = Deno.env.get("VIDEO_WORKER_URL");
  const workerSecret = Deno.env.get("VIDEO_WORKER_SECRET");

  if (!workerUrl) {
    await markJobError(
      jobId,
      "VIDEO_WORKER_URL is not configured. Deploy the video worker and set this Supabase secret.",
    );
    return;
  }

  try {
    // O status já foi movido para processing por claimJob antes desta função ser agendada.
    let response: Response;
    try {
      response = await fetch(`${workerUrl.replace(/\/$/, "")}/process-job`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {}),
        },
        body: JSON.stringify({ jobId }),
      });
    } catch (error) {
      // Falha de rede (worker fora do ar ou reiniciando) é infra, não job ruim. O fetch
      // do Deno lança TypeError com a mensagem crua do cliente Rust ("tcp connect error:
      // Connection refused"), que nenhum padrão do retry-failed-jobs reconhecia. O
      // prefixo estável deixa o auto-retry pegar e o erro legível na UI.
      const detail = error instanceof Error ? error.message : String(error);
      await markJobError(jobId, `worker_unreachable: ${detail}`);
      return;
    }

    // O worker aplica backpressure quando a fila está cheia. Devolvemos o job para
    // pending e deixamos a mensagem na pgmq, que reentrega depois — marcar error aqui
    // queimaria um job que não tem nada de errado.
    if (response.status === 503) {
      await service
        .from("reel_jobs")
        .update({ status: "pending", error_message: null })
        .eq("id", jobId);
      return;
    }

    if (!response.ok) {
      throw new Error(await readWorkerError(response));
    }

    // O worker aceitou o job. A mensagem correspondente na pgmq não serve mais para nada:
    // se ficar na fila, uma leitura futura reprocessa e republica um job já publicado.
    // No caminho direto não temos o msg_id, então limpamos por job_id — era exatamente
    // esse vazamento que enchia a fila com uma mensagem órfã por job criado.
    if (msgId !== null) {
      await service.rpc("delete_reel_job_message", { msg_id: msgId });
    } else {
      await service.rpc("delete_reel_job_messages_for_job", { job_id: jobId });
    }
  } catch (error) {
    await markJobError(
      jobId,
      error instanceof Error ? error.message : "Failed to dispatch video worker",
    );
  }
}

async function markJobError(jobId: string, errorMessage: string) {
  const service = createServiceClient();

  // processJob writes its own, more specific error before failing the request;
  // keep that one rather than replacing it with the dispatch-level message.
  const { data } = await service
    .from("reel_jobs")
    .select("status, error_message")
    .eq("id", jobId)
    .maybeSingle();

  if (data?.status === "error" && data?.error_message) return;

  await service
    .from("reel_jobs")
    .update({ status: "error", error_message: errorMessage })
    .eq("id", jobId);
}
