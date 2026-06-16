import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";
import { zernioRequest } from "../_shared/zernio.ts";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

type ScheduleItem =
  | { kind: "rendered_job"; jobId: string }
  | { kind: "library"; sourceVideoId: string; overlayText?: string; caption?: string }
  | { kind: "url"; url: string; overlayText?: string; caption?: string };

type ScheduleBody = {
  avatarId: string;
  accountId: string;
  reactionIds?: string[];
  overlayPhrases?: string[];
  captions?: string[];
  hashtags?: string;
  items: ScheduleItem[];
  schedule: { weekdays: number[]; times: string[]; timezone?: string };
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const authorization = request.headers.get("Authorization");
    const body = (await request.json()) as ScheduleBody;

    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);

    const items = body.items ?? [];
    if (items.length === 0) throw new Error("items is required");
    if (items.length > 100) throw new Error("Maximum 100 items per batch");

    const { weekdays, times } = body.schedule ?? {};
    if (!Array.isArray(weekdays) || weekdays.length === 0) throw new Error("schedule.weekdays is required");
    if (!Array.isArray(times) || times.length === 0) throw new Error("schedule.times is required");

    // Validate account belongs to user + avatar
    const { data: account, error: accountError } = await service
      .from("social_accounts")
      .select("*")
      .eq("id", body.accountId)
      .eq("user_id", user.id)
      .eq("avatar_id", avatar.id)
      .eq("active", true)
      .single();
    if (accountError || !account) throw new Error("Invalid or inactive social account");

    const rawItems = items.filter((item) => item.kind !== "rendered_job");
    const hasRaw = rawItems.length > 0;

    const reactionIds = uniqueStrings(body.reactionIds);
    const overlayPhrases = nonEmpty(body.overlayPhrases ?? []);
    const captions = nonEmpty(body.captions ?? []);

    // A list is only needed as a fallback when some raw item leaves that field
    // blank (i.e. still relies on the random pick).
    const needsOverlayList = rawItems.some(
      (item) => !(item.kind !== "rendered_job" && item.overlayText?.trim()),
    );
    const needsCaptionList = rawItems.some(
      (item) => !(item.kind !== "rendered_job" && item.caption?.trim()),
    );

    if (hasRaw) {
      if (reactionIds.length === 0) throw new Error("reactionIds is required for library/url items");
      if (needsOverlayList && overlayPhrases.length === 0) throw new Error("overlayPhrases is required for library/url items");
      if (needsCaptionList && captions.length === 0) throw new Error("captions is required for library/url items");
    }

    // Validate reactions belong to avatar (only if raw items)
    if (hasRaw) {
      const { data: reactions, error: reactionError } = await service
        .from("reaction_videos")
        .select("id")
        .eq("avatar_id", avatar.id)
        .eq("user_id", user.id)
        .in("id", reactionIds);
      if (reactionError) throw reactionError;
      if ((reactions?.length ?? 0) !== reactionIds.length) throw new Error("Invalid reaction selection");
    }

    // Compute slots
    const slots = computeSlots({ weekdays, times, count: items.length });

    // Process items
    const createdJobIds: string[] = [];
    const scheduledJobIds: string[] = [];
    const newRows: Record<string, unknown>[] = [];
    const newRowSlots: string[] = [];
    const renderedUpdates: { jobId: string; slot: string }[] = [];

    let rawIdx = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const slot = slots[i];

      if (item.kind === "rendered_job") {
        renderedUpdates.push({ jobId: item.jobId, slot: slot ?? "" });
      } else {
        const reactionId = reactionIds[rawIdx % reactionIds.length];
        const overlayText = item.overlayText?.trim() || pickRandom(overlayPhrases);
        const baseCaption = item.caption?.trim() || pickRandom(captions);
        const caption = body.hashtags ? `${baseCaption}\n\n${body.hashtags}` : baseCaption;
        const clipUrl =
          item.kind === "library" ? `source-video:${item.sourceVideoId}` : item.url;
        const sourceVideoId = item.kind === "library" ? item.sourceVideoId : null;

        newRows.push({
          user_id: user.id,
          avatar_id: avatar.id,
          account_id: account.id,
          source_video_id: sourceVideoId,
          reaction_id: reactionId,
          clip_url: clipUrl,
          overlay_text: overlayText,
          caption,
          scheduled_post_at: slot ?? null,
          status: "pending",
        });
        newRowSlots.push(slot ?? "");
        rawIdx++;
      }
    }

    // Validate and update rendered jobs
    for (const { jobId, slot } of renderedUpdates) {
      const { data: job, error: jobError } = await service
        .from("reel_jobs")
        .select("id, status, output_path, user_id, avatar_id, scheduled_post_at")
        .eq("id", jobId)
        .eq("user_id", user.id)
        .eq("avatar_id", avatar.id)
        .single();

      if (jobError || !job) throw new Error(`Job ${jobId} not found`);
      if (job.status !== "rendered" || !job.output_path) {
        throw new Error(`Job ${jobId} is not in rendered state`);
      }
      if (job.status === "posting" || job.status === "posted") {
        throw new Error(`Job ${jobId} is already scheduled or posted`);
      }

      const { error: updateError } = await service
        .from("reel_jobs")
        .update({ account_id: account.id, scheduled_post_at: slot })
        .eq("id", jobId);
      if (updateError) throw updateError;

      scheduledJobIds.push(jobId);
    }

    // Insert new jobs
    if (newRows.length > 0) {
      const { data: jobs, error: insertError } = await service
        .from("reel_jobs")
        .insert(newRows)
        .select("id");
      if (insertError) throw insertError;

      for (const job of jobs ?? []) {
        const { error: enqueueError } = await service.rpc("enqueue_reel_job", {
          job_id: job.id,
        });
        if (enqueueError) throw enqueueError;
        createdJobIds.push(job.id);
      }

      if (createdJobIds.length > 0) {
        EdgeRuntime.waitUntil(triggerProcessor(
          createdJobIds.map((id) => ({ id })),
          authorization,
        ));
      }
    }

    // Dispatch post-to-zernio for rendered jobs (already have video, Zernio handles scheduling)
    if (scheduledJobIds.length > 0) {
      EdgeRuntime.waitUntil(postRenderedJobs(scheduledJobIds, authorization));
    }

    return jsonResponse({
      created: createdJobIds.length,
      scheduled: scheduledJobIds.length,
      jobs: createdJobIds.map((id) => ({ id })),
      scheduledJobs: scheduledJobIds.map((id) => ({ id })),
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(String).filter(Boolean)));
}

function nonEmpty(arr: string[]): string[] {
  return arr.map((s) => s.trim()).filter(Boolean);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// São Paulo is UTC-3 year-round (Brazil abolished DST in 2019).
const SP_OFFSET_HOURS = 3;
const SLOT_LEAD_MS = 5 * 60 * 1000;

function computeSlots({
  weekdays,
  times,
  count,
}: {
  weekdays: number[];
  times: string[];
  count: number;
}): string[] {
  if (!weekdays.length || !times.length || count <= 0) return [];

  const sortedTimes = [...times].sort();
  const minInstant = Date.now() + SLOT_LEAD_MS;
  const slots: string[] = [];
  // Edge runtime is UTC. Iterate days by SP wall-clock by anchoring on SP "now".
  const nowSp = new Date(Date.now() - SP_OFFSET_HOURS * 3600 * 1000);
  const cursor = new Date(Date.UTC(nowSp.getUTCFullYear(), nowSp.getUTCMonth(), nowSp.getUTCDate()));

  const maxDays = 730;
  let dayCount = 0;

  while (slots.length < count && dayCount < maxDays) {
    if (weekdays.includes(cursor.getUTCDay())) {
      const y = cursor.getUTCFullYear();
      const mo = cursor.getUTCMonth();
      const d = cursor.getUTCDate();
      for (const time of sortedTimes) {
        if (slots.length >= count) break;
        const [h, m] = time.split(":").map(Number);
        // Real instant of this SP wall-clock slot: SP time + 3h = UTC.
        const slotInstant = Date.UTC(y, mo, d, h + SP_OFFSET_HOURS, m ?? 0, 0);
        if (slotInstant < minInstant) continue;
        const moStr = String(mo + 1).padStart(2, "0");
        const dStr = String(d).padStart(2, "0");
        const hh = String(h).padStart(2, "0");
        const mm = String(m ?? 0).padStart(2, "0");
        slots.push(`${y}-${moStr}-${dStr}T${hh}:${mm}:00`);
      }
    }
    dayCount++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return slots;
}

async function triggerProcessor(
  jobs: Array<{ id: string }>,
  authorization: string | null,
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl || !authorization) return;

  const concurrency = 3;
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (job) => {
        const response = await fetch(`${supabaseUrl}/functions/v1/reel-processor`, {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ jobId: job.id }),
        });
        if (!response.ok) {
          console.error(`Failed to trigger reel-processor for ${job.id}: ${await response.text()}`);
        }
      }),
    );
  }
}

async function postRenderedJobs(
  jobIds: string[],
  authorization: string | null,
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl || !authorization) return;

  for (const jobId of jobIds) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/post-to-zernio`, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId }),
      });
      if (!response.ok) {
        console.error(`Failed to post-to-zernio for ${jobId}: ${await response.text()}`);
      }
    } catch (err) {
      console.error(`Error posting rendered job ${jobId}:`, err);
    }
  }
}
