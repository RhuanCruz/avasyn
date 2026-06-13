import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, getAuthenticatedUser, resolveOwnedAvatar } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();

    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);
    const { weekdays, times } = body.schedule ?? {};

    if (!Array.isArray(weekdays) || weekdays.length === 0) throw new Error("schedule.weekdays is required");
    if (!Array.isArray(times) || times.length === 0) throw new Error("schedule.times is required");

    // Fetch all jobs that are pending reschedule (not yet posted/posting)
    const { data: jobs, error: fetchError } = await service
      .from("reel_jobs")
      .select("id, scheduled_post_at, status")
      .eq("avatar_id", avatar.id)
      .eq("user_id", user.id)
      .not("scheduled_post_at", "is", null)
      .in("status", ["pending", "rendered", "error", "processing"])
      .order("scheduled_post_at", { ascending: true });

    if (fetchError) throw fetchError;
    if (!jobs || jobs.length === 0) {
      return jsonResponse({ updated: 0, message: "No reschedulable jobs found" });
    }

    // Compute new slots starting from now
    const slots = computeSlots({ weekdays, times, count: jobs.length });

    if (slots.length < jobs.length) {
      throw new Error("Could not compute enough slots for the given schedule. Try adding more days or times.");
    }

    // Update each job with its new slot (preserve original order = current scheduled order)
    let updated = 0;
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const newSlot = slots[i];

      const { error: updateError } = await service
        .from("reel_jobs")
        .update({ scheduled_post_at: newSlot })
        .eq("id", job.id);

      if (updateError) {
        console.error(`Failed to update job ${job.id}:`, updateError.message);
      } else {
        updated++;
      }
    }

    return jsonResponse({ updated, total: jobs.length });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

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
