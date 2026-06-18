import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { verifyZernioWebhookSignature } from "../_shared/zernio.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const body = await request.text();
  const signature = request.headers.get("X-Zernio-Signature");

  if (!(await verifyZernioWebhookSignature(body, signature))) {
    return jsonResponse({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const payload = JSON.parse(body);
    const eventId = payload.id ?? payload.eventId ?? crypto.randomUUID();
    const event = payload.event ?? payload.type;
    const service = createServiceClient();

    const { error: eventError } = await service.from("zernio_webhook_events").insert({
      id: eventId,
      event,
      payload,
    });
    if (eventError && !eventError.message.includes("duplicate key")) {
      throw eventError;
    }
    if (eventError) {
      return jsonResponse({ duplicate: true });
    }

    const zernioPostId = payload.postId ?? payload.post?._id ?? payload.post?.id;
    const status = mapWebhookStatus(event);
    if (zernioPostId && status) {
      const platformPostUrl =
        payload.platformPostUrl ?? payload.post?.platformPostUrl ?? null;
      const errorMessage = payload.error ?? payload.message ?? null;
      const postedAt = status === "published" ? new Date().toISOString() : null;
      const jobStatus = status === "published" ? "posted" : "error";

      // Update aggregate job
      await service
        .from("reel_jobs")
        .update({
          status: jobStatus,
          platform_post_url: platformPostUrl,
          error_message: errorMessage,
          posted_at: postedAt,
        })
        .eq("zernio_post_id", zernioPostId);

      // Update per-platform targets
      // Narrow by platform/accountId from webhook payload if available
      const webhookPlatform = payload.platform ?? payload.post?.platform ?? null;

      const { data: targets } = await service
        .from("reel_job_targets")
        .select("id, job_id, account_id")
        .eq("zernio_post_id", zernioPostId);

      const matchedTargets = (targets ?? []).filter((t) => {
        if (!webhookPlatform) return true; // no platform info → update all
        // We'd need to join social_accounts.platform to narrow, but skip for now
        // and rely on job-level update; per-target status comes from post_history
        return true;
      });

      for (const t of matchedTargets) {
        await service
          .from("reel_job_targets")
          .update({
            status,
            platform_post_url: platformPostUrl,
            error_message: errorMessage,
            posted_at: postedAt,
          })
          .eq("id", t.id);
      }

      // Upsert post_history per target
      const { data: jobs } = await service
        .from("reel_jobs")
        .select("id,user_id,avatar_id,account_id")
        .eq("zernio_post_id", zernioPostId);

      for (const job of jobs ?? []) {
        if (matchedTargets.length > 0) {
          // Multi-target path: upsert per target
          for (const t of matchedTargets.filter((mt) => mt.job_id === job.id)) {
            await service.from("post_history").upsert(
              {
                user_id: job.user_id,
                avatar_id: job.avatar_id,
                job_id: job.id,
                account_id: t.account_id,
                zernio_post_id: zernioPostId,
                platform_post_url: platformPostUrl,
                status,
                error_message: errorMessage,
                posted_at: postedAt,
              },
              { onConflict: "job_id,account_id" },
            );
          }
        } else {
          // Legacy path: no targets, use job.account_id
          if (!job.account_id) continue;
          await service.from("post_history").upsert(
            {
              user_id: job.user_id,
              avatar_id: job.avatar_id,
              job_id: job.id,
              account_id: job.account_id,
              zernio_post_id: zernioPostId,
              platform_post_url: platformPostUrl,
              status,
              error_message: errorMessage,
              posted_at: postedAt,
            },
            { onConflict: "job_id,account_id" },
          );
        }
      }
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function mapWebhookStatus(event: string | undefined) {
  if (event === "post.published") return "published";
  if (event === "post.failed") return "failed";
  if (event === "post.partial") return "partial";
  if (event === "post.cancelled") return "cancelled";
  return null;
}
