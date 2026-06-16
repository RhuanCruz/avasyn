import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";
import {
  buildInstagramReelPayload,
  uploadVideoToZernio,
  zernioRequest,
} from "../_shared/zernio.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  let jobId: string | null = null;
  try {
    const service = createServiceClient();
    const body = await request.json();
    jobId = body.jobId;
    if (!jobId) throw new Error("jobId is required");

    const user = body.accountId ? await getAuthenticatedUser(request) : null;

    const { data: job, error } = await service
      .from("reel_jobs")
      .select("*, social_accounts(*), automations(share_to_feed)")
      .eq("id", jobId)
      .single();
    if (error || !job) throw new Error("Job not found");
    if (user && job.user_id !== user.id) throw new Error("Job not found");
    if (!job.output_path) throw new Error("Job has no rendered output");

    let account = job.social_accounts;
    let scheduledPostAt = job.scheduled_post_at;

    if (body.accountId) {
      const { data: selectedAccount, error: accountError } = await service
        .from("social_accounts")
        .select("*")
        .eq("id", body.accountId)
        .eq("user_id", user?.id)
        .eq("avatar_id", job.avatar_id)
        .single();
      if (accountError || !selectedAccount) throw new Error("Invalid account");

      account = selectedAccount;
      scheduledPostAt = body.scheduledFor ?? null;

      await service
        .from("reel_jobs")
        .update({
          account_id: body.accountId,
          scheduled_post_at: scheduledPostAt,
        })
        .eq("id", job.id);
    }

    if (!account) throw new Error("Account is required before posting");
    if (account.user_id !== job.user_id || account.avatar_id !== job.avatar_id) {
      throw new Error("Account does not belong to this job's avatar");
    }

    await service.from("reel_jobs").update({ status: "posting" }).eq("id", job.id);

    const { data: file, error: downloadError } = await service.storage
      .from("generated-reels")
      .download(job.output_path);
    if (downloadError || !file) throw new Error("Failed to download generated reel");

    const mediaUrl = await uploadVideoToZernio(
      `${job.id}.mp4`,
      await file.arrayBuffer(),
    );
    const payload = buildInstagramReelPayload({
      accountId: account.zernio_account_id,
      caption: job.caption,
      mediaUrl,
      publishNow: !scheduledPostAt,
      scheduledFor: scheduledPostAt,
      shareToFeed: job.automations?.share_to_feed ?? true,
    });

    const response = await zernioRequest<{ post?: { _id?: string; id?: string; platforms?: unknown[] } }>(
      "/posts",
      {
        body: payload,
        requestId: job.id,
      },
    );

    const zernioPostId = response.post?._id ?? response.post?.id ?? null;

    await service
      .from("reel_jobs")
      .update({
        status: scheduledPostAt ? "posting" : "posted",
        zernio_media_url: mediaUrl,
        zernio_post_id: zernioPostId,
        posted_at: scheduledPostAt ? null : new Date().toISOString(),
      })
      .eq("id", job.id);

    await service.from("post_history").insert({
      user_id: job.user_id,
      avatar_id: job.avatar_id,
      job_id: job.id,
      account_id: account.id,
      zernio_post_id: zernioPostId,
      status: scheduledPostAt ? "scheduled" : "published",
      posted_at: scheduledPostAt ? null : new Date().toISOString(),
    });

    return jsonResponse({ post: response.post, mediaUrl });
  } catch (error) {
    if (jobId) {
      const service = createServiceClient();
      await service
        .from("reel_jobs")
        .update({
          status: "error",
          error_message: error instanceof Error ? error.message : "Unknown error",
        })
        .eq("id", jobId);
    }

    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
