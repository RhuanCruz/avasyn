import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const service = createServiceClient();
    const now = new Date();
    const hhmm = now.toISOString().slice(11, 16);

    const { data: automations, error } = await service
      .from("automations")
      .select("*")
      .eq("active", true)
      .contains("post_times", [hhmm]);
    if (error) throw error;

    const createdJobs: Array<{ id: string }> = [];
    for (const automation of automations ?? []) {
      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);

      const { count, error: countError } = await service
        .from("reel_jobs")
        .select("id", { count: "exact", head: true })
        .eq("automation_id", automation.id)
        .gte("created_at", dayStart.toISOString());
      if (countError) throw countError;
      if ((count ?? 0) >= automation.posts_per_day) continue;

      const clipUrl = pickRandom(automation.clip_urls);
      const reactionId = pickRandom(automation.reaction_pool);
      if (!clipUrl || !reactionId) continue;

      const { data: job, error: insertError } = await service
        .from("reel_jobs")
        .insert({
          user_id: automation.user_id,
          avatar_id: automation.avatar_id,
          automation_id: automation.id,
          account_id: automation.account_id,
          clip_url: clipUrl,
          reaction_id: reactionId,
          overlay_text: automation.overlay_text,
          caption: automation.caption_template,
          scheduled_post_at: now.toISOString(),
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      const { error: enqueueError } = await service.rpc("enqueue_reel_job", {
        job_id: job.id,
      });
      if (enqueueError) throw enqueueError;
      createdJobs.push({ id: job.id });
    }

    if (createdJobs.length > 0) {
      EdgeRuntime.waitUntil(triggerProcessor(createdJobs));
    }

    return jsonResponse({ created: createdJobs.length });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function pickRandom<T>(items: T[] | null): T | null {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

async function triggerProcessor(jobs: Array<{ id: string }>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;

  await Promise.all(
    jobs.map((job) =>
      fetch(`${supabaseUrl}/functions/v1/reel-processor`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId: job.id }),
      }),
    ),
  );
}
