import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { downloadBytes } from "../_shared/storage.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";
import {
  buildReelPostPayload,
  uploadVideoToZernio,
  zernioRequest,
  type ZernioTarget,
} from "../_shared/zernio.ts";

type ZernioPlatformResult = {
  platform?: string;
  accountId?: string;
  platformPostUrl?: string;
  url?: string;
  status?: string;
};

type DbTarget = {
  account_id: string;
  platform: string;
  social_accounts: {
    id: string;
    zernio_account_id: string;
    user_id: string;
    avatar_id: string;
    platform: string;
  } | null;
};

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
      .select("*, social_accounts(*), automations(share_to_feed), reel_job_targets(*, social_accounts(*))")
      .eq("id", jobId)
      .single();
    if (error || !job) throw new Error("Job not found");
    if (user && job.user_id !== user.id) throw new Error("Job not found");
    if (!job.output_path) throw new Error("Job has no rendered output");

    let scheduledPostAt = job.scheduled_post_at;

    // Manual override via body.accountId (from UI posting flow)
    if (body.accountId) {
      const { data: selectedAccount, error: accountError } = await service
        .from("social_accounts")
        .select("*")
        .eq("id", body.accountId)
        .eq("user_id", user?.id)
        .eq("avatar_id", job.avatar_id)
        .single();
      if (accountError || !selectedAccount) throw new Error("Invalid account");

      scheduledPostAt = body.scheduledFor ?? null;

      await service
        .from("reel_jobs")
        .update({
          account_id: body.accountId,
          scheduled_post_at: scheduledPostAt,
        })
        .eq("id", job.id);
    }

    // Resolve posting targets: prefer reel_job_targets (multi-platform), fall back to legacy single account
    const dbTargets = (job.reel_job_targets ?? []) as DbTarget[];

    let targets: ZernioTarget[] = [];
    let accountIdForHistory = job.account_id as string | null;

    if (dbTargets.length > 0) {
      for (const t of dbTargets) {
        const sa = t.social_accounts;
        if (!sa) continue;
        if (sa.user_id !== job.user_id || sa.avatar_id !== job.avatar_id) {
          throw new Error("Target account does not belong to this job's avatar");
        }
        targets.push({ platform: t.platform as "instagram" | "youtube", accountId: sa.zernio_account_id });
      }
    } else {
      // Legacy / automation path: single account
      const account = job.social_accounts as {
        id: string;
        zernio_account_id: string;
        user_id: string;
        avatar_id: string;
        platform: string;
      } | null;
      if (!account) throw new Error("Account is required before posting");
      if (account.user_id !== job.user_id || account.avatar_id !== job.avatar_id) {
        throw new Error("Account does not belong to this job's avatar");
      }
      targets = [{ platform: (account.platform ?? "instagram") as "instagram" | "youtube", accountId: account.zernio_account_id }];
      accountIdForHistory = account.id;
    }

    if (targets.length === 0) throw new Error("No valid targets to post to");

    await service.from("reel_jobs").update({ status: "posting" }).eq("id", job.id);

    const fileBuffer = await downloadBytes("generated-reels", job.output_path);
    const mediaUrl = await uploadVideoToZernio(`${job.id}.mp4`, fileBuffer);

    const payload = buildReelPostPayload({
      targets,
      caption: job.caption,
      mediaUrl,
      publishNow: !scheduledPostAt,
      scheduledFor: scheduledPostAt,
      shareToFeed: job.automations?.share_to_feed ?? true,
    });

    const response = await zernioRequest<{
      post?: { _id?: string; id?: string; platforms?: ZernioPlatformResult[] };
    }>(
      "/posts",
      { body: payload, requestId: job.id },
    );

    console.log("Zernio /posts response:", JSON.stringify(response));

    const zernioPostId = response.post?._id ?? response.post?.id ?? null;
    const platformResults = (response.post?.platforms ?? []) as ZernioPlatformResult[];
    const firstUrl = platformResults[0]?.platformPostUrl ?? platformResults[0]?.url ?? null;

    await service
      .from("reel_jobs")
      .update({
        status: scheduledPostAt ? "posting" : "posted",
        zernio_media_url: mediaUrl,
        zernio_post_id: zernioPostId,
        platform_post_url: firstUrl,
        posted_at: scheduledPostAt ? null : new Date().toISOString(),
      })
      .eq("id", job.id);

    // Update each target and build post_history rows
    if (dbTargets.length > 0 && zernioPostId) {
      for (const t of dbTargets) {
        if (!t.social_accounts) continue;
        const platformResult = platformResults.find(
          (r) => r.platform === t.platform &&
            (!r.accountId || r.accountId === t.social_accounts?.zernio_account_id),
        ) ?? platformResults[0];

        await service
          .from("reel_job_targets")
          .update({
            zernio_post_id: zernioPostId,
            platform_post_url: platformResult?.platformPostUrl ?? platformResult?.url ?? null,
            status: scheduledPostAt ? "scheduled" : "published",
            posted_at: scheduledPostAt ? null : new Date().toISOString(),
          })
          .eq("job_id", job.id)
          .eq("account_id", t.account_id);

        await service.from("post_history").upsert(
          {
            user_id: job.user_id,
            avatar_id: job.avatar_id,
            job_id: job.id,
            account_id: t.account_id,
            zernio_post_id: zernioPostId,
            platform_post_url: platformResult?.platformPostUrl ?? platformResult?.url ?? null,
            status: scheduledPostAt ? "scheduled" : "published",
            posted_at: scheduledPostAt ? null : new Date().toISOString(),
          },
          { onConflict: "job_id,account_id" },
        );
      }
    } else {
      // Legacy single-account path
      await service.from("post_history").upsert(
        {
          user_id: job.user_id,
          avatar_id: job.avatar_id,
          job_id: job.id,
          account_id: accountIdForHistory,
          zernio_post_id: zernioPostId,
          platform_post_url: firstUrl,
          status: scheduledPostAt ? "scheduled" : "published",
          posted_at: scheduledPostAt ? null : new Date().toISOString(),
        },
        { onConflict: "job_id,account_id" },
      );
    }

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
