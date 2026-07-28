import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

type QueueMessage = {
  msg_id: number;
  message: {
    job_id: string;
  };
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const body = await request.json().catch(() => ({}));
    if (body.jobId) {
      await assertCanProcessJob(request, String(body.jobId));
      EdgeRuntime.waitUntil(dispatchToWorker(String(body.jobId), null));
      return jsonResponse({ accepted: true, jobId: body.jobId });
    }

    const service = createServiceClient();
    const { data: messages, error } = await service.rpc("read_reel_job_messages", {
      qty: 1,
    });

    if (error) throw error;
    const message = (messages as QueueMessage[] | null)?.[0];
    if (!message) return jsonResponse({ processed: 0 });

    EdgeRuntime.waitUntil(dispatchToWorker(message.message.job_id, message.msg_id));
    return jsonResponse({ accepted: true, jobId: message.message.job_id });
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
    await service
      .from("reel_jobs")
      .update({ status: "processing", error_message: null })
      .eq("id", jobId);

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
      throw new Error(await response.text());
    }

    if (msgId !== null) {
      await service.rpc("delete_reel_job_message", {
        msg_id: msgId,
      });
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
  await service
    .from("reel_jobs")
    .update({ status: "error", error_message: errorMessage })
    .eq("id", jobId);
}
