import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { createStructuredResponse } from "../_shared/openai.ts";
import {
  canonicalizeContentUrl,
  fetchYouTubeResults,
  type NormalizedResult,
} from "../_shared/content-search.ts";

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

// São Paulo is UTC-3 year-round (Brazil abolished DST in 2019). v1 only supports
// this timezone for the scheduling window; the column is kept generic for later.
const SP_OFFSET_HOURS = 3;
const SEARCH_LIMIT = 20;

type ServiceClient = ReturnType<typeof createServiceClient>;

type Automation = {
  id: string;
  user_id: string;
  avatar_id: string;
  account_id: string | null;
  account_ids: string[] | null;
  status: string;
  active: boolean;
  search_queries: string[];
  source_platforms: string[];
  days_of_week: number[];
  post_times: string[];
  posts_per_day: number;
  timezone: string;
  reaction_pool: string[];
  overlay_mode: "none" | "fixed" | "ideas" | "ai";
  overlay_text: string;
  overlay_ideas: string[];
  overlay_ai_instructions: string;
  caption_mode: "fixed" | "ideas" | "ai";
  caption_template: string;
  caption_ideas: string[];
  caption_ai_instructions: string;
  min_view_count: number;
  max_duration_s: number;
  recent_days: number;
};

type ForceMode = "now" | "next_slot";

function automationAccounts(automation: Automation): string[] {
  if (automation.account_ids && automation.account_ids.length > 0) return automation.account_ids;
  return automation.account_id ? [automation.account_id] : [];
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const service = createServiceClient();
    const body = await request.json().catch(() => ({}));
    const automationId = typeof body.automationId === "string" ? body.automationId : null;
    const force = body.force === true;
    const forceMode: ForceMode = body.mode === "next_slot" ? "next_slot" : "now";
    const seed = Number(body.seed) > 0 ? Math.min(50, Math.trunc(Number(body.seed))) : 0;

    let query = service.from("automations").select("*");
    query = automationId
      ? query.eq("id", automationId)
      : query.eq("status", "active").eq("active", true);

    const { data: automations, error } = await query;
    if (error) throw error;

    let runsCreated = 0;
    let jobsCreated = 0;
    let skipped = 0;

    for (const automation of (automations ?? []) as Automation[]) {
      // Seed mode: eagerly generate up to N posts at the next N scheduled slots
      // (ignores the 5-min window and posts_per_day; still respects dedup).
      if (seed > 0) {
        const slots = computeNextSlots(automation.post_times, automation.days_of_week, seed);
        for (const slotAt of slots) {
          const result = await runAutomation(service, automation, { slotAt, postAt: slotAt });
          if (result === "skipped") skipped++;
          else {
            runsCreated++;
            if (result === "job_created") jobsCreated++;
          }
        }
        continue;
      }

      const slot = resolveSlot(automation, force, forceMode);
      if (!slot) {
        skipped++;
        continue;
      }

      // posts_per_day cap (ignored in force mode for manual testing).
      if (!force) {
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const { count } = await service
          .from("reel_jobs")
          .select("id", { count: "exact", head: true })
          .eq("automation_id", automation.id)
          .gte("created_at", dayStart.toISOString());
        if ((count ?? 0) >= automation.posts_per_day) {
          skipped++;
          continue;
        }
      }

      const result = await runAutomation(service, automation, slot);
      if (result === "skipped") skipped++;
      else {
        runsCreated++;
        if (result === "job_created") jobsCreated++;
      }
    }

    return jsonResponse({ runsCreated, jobsCreated, skipped });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

type RunOutcome = "job_created" | "no_candidate" | "error" | "skipped";

async function runAutomation(
  service: ServiceClient,
  automation: Automation,
  slot: { slotAt: string; postAt: string | null },
): Promise<RunOutcome> {
  // Reserve the slot first (idempotency: one run per automation per slot).
  const { data: run, error: runError } = await service
    .from("automation_runs")
    .insert({
      user_id: automation.user_id,
      avatar_id: automation.avatar_id,
      automation_id: automation.id,
      scheduled_slot_at: slot.slotAt,
      status: "searching",
    })
    .select("id")
    .single();

  if (runError) {
    // 23505 = unique violation → a run for this slot already exists, skip silently.
    if ((runError as { code?: string }).code === "23505") return "skipped";
    throw runError;
  }
  const runId = run.id as string;

  try {
    const accounts = automationAccounts(automation);
    if (accounts.length === 0) {
      return await failRun(service, automation, runId, "Conta social não conectada.");
    }
    if (automation.reaction_pool.length === 0) {
      return await failRun(service, automation, runId, "Nenhuma reaction no pool.");
    }
    if (automation.search_queries.length === 0) {
      return await failRun(service, automation, runId, "Nenhum tema de busca configurado.");
    }

    const queryText = pickQuery(automation);
    await service.from("automation_runs").update({ query: queryText }).eq("id", runId);

    const candidates = await searchCandidates(automation, queryText);

    // Walk candidates, log each, reserve the first new one that passes filters.
    let reserved:
      | { candidate: NormalizedResult; usageId: string; candidateUrl: string }
      | null = null;

    for (const candidate of candidates) {
      const canonical = canonicalizeContentUrl(candidate.resultUrl);
      const externalId = candidate.externalId ?? canonical.externalId;
      const platform = candidate.platform;

      // Filters: duration + min views.
      const durationOk = candidate.durationS == null ||
        candidate.durationS <= automation.max_duration_s;
      const viewsOk = (candidate.viewCount ?? 0) >= automation.min_view_count;
      if (!durationOk || !viewsOk) {
        await logCandidate(service, automation, runId, candidate, canonical.canonicalUrl, externalId, "skipped_filter", !durationOk ? "duration" : "min_views");
        continue;
      }

      // Try to reserve in content_usage (dedup per avatar).
      const { data: usage, error: usageError } = await service
        .from("content_usage")
        .insert({
          user_id: automation.user_id,
          avatar_id: automation.avatar_id,
          automation_id: automation.id,
          source_platform: platform,
          source_external_id: externalId,
          canonical_url: canonical.canonicalUrl,
          source_url: candidate.resultUrl,
          status: "reserved",
        })
        .select("id")
        .single();

      if (usageError) {
        if ((usageError as { code?: string }).code === "23505") {
          await logCandidate(service, automation, runId, candidate, canonical.canonicalUrl, externalId, "skipped_used", "already_used");
          continue;
        }
        throw usageError;
      }

      await logCandidate(service, automation, runId, candidate, canonical.canonicalUrl, externalId, "reserved", null);
      reserved = { candidate, usageId: usage.id as string, candidateUrl: candidate.resultUrl };
      break;
    }

    if (!reserved) {
      await service
        .from("automation_runs")
        .update({ status: "no_candidate", completed_at: new Date().toISOString() })
        .eq("id", runId);
      await touchAutomation(service, automation.id, null);
      return "no_candidate";
    }

    const reactionId = await pickReaction(service, automation);
    const overlayText = await resolveOverlay(automation, reserved.candidate);
    const caption = await resolveCaption(automation, reserved.candidate);

    const { data: job, error: jobError } = await service
      .from("reel_jobs")
      .insert({
        user_id: automation.user_id,
        avatar_id: automation.avatar_id,
        automation_id: automation.id,
        account_id: accounts[0],
        clip_url: reserved.candidate.resultUrl,
        source_video_id: null,
        reaction_id: reactionId,
        overlay_text: overlayText,
        caption,
        scheduled_post_at: slot.postAt,
        status: "pending",
      })
      .select("id")
      .single();
    if (jobError) throw jobError;
    const jobId = job.id as string;

    // Multi-account fan-out: create one target per account (post-to-zernio reads these).
    if (accounts.length > 1) {
      const { data: accountRows } = await service
        .from("social_accounts")
        .select("id, platform")
        .in("id", accounts);
      const targetRows = (accountRows ?? []).map((acc: { id: string; platform: string }) => ({
        job_id: jobId,
        account_id: acc.id,
        platform: acc.platform,
        status: "scheduled",
      }));
      if (targetRows.length > 0) {
        await service.from("reel_job_targets").upsert(targetRows, { onConflict: "job_id,account_id" });
      }
    }

    await service
      .from("content_usage")
      .update({ reel_job_id: jobId, status: "job_created" })
      .eq("id", reserved.usageId);

    await service
      .from("automation_runs")
      .update({
        status: "job_created",
        reel_job_id: jobId,
        content_usage_id: reserved.usageId,
        candidate_url: reserved.candidateUrl,
        source_platform: reserved.candidate.platform,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    const { error: enqueueError } = await service.rpc("enqueue_reel_job", { job_id: jobId });
    if (enqueueError) throw enqueueError;

    await touchAutomation(service, automation.id, null);
    EdgeRuntime.waitUntil(triggerProcessor(jobId));
    return "job_created";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return await failRun(service, automation, runId, message);
  }
}

async function failRun(
  service: ServiceClient,
  automation: Automation,
  runId: string,
  message: string,
): Promise<RunOutcome> {
  await service
    .from("automation_runs")
    .update({ status: "error", error_message: message, completed_at: new Date().toISOString() })
    .eq("id", runId);
  await touchAutomation(service, automation.id, message);
  return "error";
}

async function touchAutomation(service: ServiceClient, id: string, error: string | null) {
  await service
    .from("automations")
    .update({ last_run_at: new Date().toISOString(), last_error_message: error })
    .eq("id", id);
}

async function logCandidate(
  service: ServiceClient,
  automation: Automation,
  runId: string,
  candidate: NormalizedResult,
  canonicalUrl: string,
  externalId: string | null,
  status: string,
  skipReason: string | null,
) {
  await service.from("automation_candidates").insert({
    user_id: automation.user_id,
    avatar_id: automation.avatar_id,
    automation_id: automation.id,
    run_id: runId,
    source_platform: candidate.platform,
    source_external_id: externalId,
    source_url: candidate.resultUrl,
    canonical_url: canonicalUrl,
    title: candidate.title,
    thumbnail_url: candidate.thumbnailUrl,
    duration_s: candidate.durationS,
    view_count: candidate.viewCount,
    published_at: candidate.publishedAt,
    status,
    skip_reason: skipReason,
    raw: candidate.raw,
  });
}

// --- Search -----------------------------------------------------------------

async function searchCandidates(
  automation: Automation,
  queryText: string,
): Promise<NormalizedResult[]> {
  // v1: YouTube Shorts only. First by date, fall back to relevance for breadth.
  const byDate = await fetchYouTubeResults(queryText, SEARCH_LIMIT, undefined, {
    order: "date",
    recentDays: automation.recent_days || null,
  });
  let pool = byDate.results;
  if (pool.length < 5) {
    const byRelevance = await fetchYouTubeResults(queryText, SEARCH_LIMIT, undefined, {
      order: "relevance",
      recentDays: null,
    });
    const seen = new Set(pool.map((r) => r.externalId));
    pool = pool.concat(byRelevance.results.filter((r) => !seen.has(r.externalId)));
  }
  return pool.sort((a, b) => {
    const va = a.viewCount ?? 0;
    const vb = b.viewCount ?? 0;
    if (va !== vb) return vb - va;
    return timestampMs(b.publishedAt) - timestampMs(a.publishedAt);
  });
}

function timestampMs(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// --- Text resolution --------------------------------------------------------

function pickQuery(automation: Automation): string {
  return pickRandom(automation.search_queries) ?? automation.search_queries[0];
}

async function pickReaction(service: ServiceClient, automation: Automation): Promise<string> {
  let pool = automation.reaction_pool;
  if (pool.length > 1) {
    const { data: lastJob } = await service
      .from("reel_jobs")
      .select("reaction_id")
      .eq("automation_id", automation.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastJob?.reaction_id) {
      const filtered = pool.filter((r) => r !== lastJob.reaction_id);
      if (filtered.length > 0) pool = filtered;
    }
  }
  return pickRandom(pool) ?? automation.reaction_pool[0];
}

async function resolveOverlay(
  automation: Automation,
  candidate: NormalizedResult,
): Promise<string> {
  if (automation.overlay_mode === "none") return "";
  if (automation.overlay_mode === "fixed") return automation.overlay_text;
  if (automation.overlay_mode === "ideas") {
    return pickRandom(automation.overlay_ideas) ?? automation.overlay_text ?? "";
  }
  return generateAiText("overlay", automation, candidate);
}

async function resolveCaption(
  automation: Automation,
  candidate: NormalizedResult,
): Promise<string> {
  if (automation.caption_mode === "fixed") return automation.caption_template;
  if (automation.caption_mode === "ideas") {
    return pickRandom(automation.caption_ideas) ?? automation.caption_template ?? "";
  }
  return generateAiText("caption", automation, candidate);
}

async function generateAiText(
  kind: "overlay" | "caption",
  automation: Automation,
  candidate: NormalizedResult,
): Promise<string> {
  const isOverlay = kind === "overlay";
  const userInstructions = (isOverlay
    ? automation.overlay_ai_instructions
    : automation.caption_ai_instructions).trim();

  const base = isOverlay
    ? "Você gera o texto de overlay (divisão) de um vídeo de reação. Máximo 3 palavras, genérico, sem tentar adivinhar o que acontece no vídeo. Exemplos: 'Olha isso', 'Que lance', 'Sem reação'."
    : "Você gera a legenda de um post de reação para Instagram/YouTube. Siga as instruções do usuário sobre tom, tamanho e hashtags. A legenda nunca pode ser vazia.";

  const instruction = userInstructions
    ? `${base}\n\nInstruções do usuário:\n${userInstructions}`
    : base;

  const result = await createStructuredResponse<{ text: string }>({
    input: [
      {
        role: "developer",
        content: [{ type: "input_text", text: instruction }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: `Título do vídeo de referência (apenas contexto, não descreva): ${candidate.title ?? "(sem título)"}`,
        }],
      },
    ],
    maxOutputTokens: isOverlay ? 60 : 400,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    schemaName: isOverlay ? "overlay_text" : "caption_text",
  });

  let text = result.text.trim();
  if (isOverlay) {
    text = text.split(/\s+/).slice(0, 3).join(" ");
  }
  if (!text) throw new Error("OpenAI retornou texto vazio");
  return text;
}

// --- Slot computation -------------------------------------------------------

function resolveSlot(
  automation: Automation,
  force: boolean,
  forceMode: ForceMode,
): { slotAt: string; postAt: string | null } | null {
  if (force) {
    if (forceMode === "now") {
      return { slotAt: new Date().toISOString(), postAt: null };
    }
    const next = computeNextSlot(automation.post_times, automation.days_of_week);
    return next ? { slotAt: next, postAt: next } : { slotAt: new Date().toISOString(), postAt: null };
  }

  // Cron path: does the current 5-minute window match a scheduled post time today?
  const nowSp = new Date(Date.now() - SP_OFFSET_HOURS * 3600 * 1000);
  const dow = nowSp.getUTCDay();
  if (!automation.days_of_week.includes(dow)) return null;

  const nowMin = nowSp.getUTCHours() * 60 + nowSp.getUTCMinutes();
  const windowStart = Math.floor(nowMin / 5) * 5;
  const matched = [...automation.post_times].find((t) => {
    const [h, m] = t.split(":").map(Number);
    const tm = h * 60 + (m ?? 0);
    return tm >= windowStart && tm < windowStart + 5;
  });
  if (!matched) return null;

  const [h, m] = matched.split(":").map(Number);
  const slot = spWallClock(nowSp.getUTCFullYear(), nowSp.getUTCMonth(), nowSp.getUTCDate(), h, m ?? 0);
  return { slotAt: slot, postAt: slot };
}

// Build an SP wall-clock ISO string (no offset) — same convention used by
// schedule-posts so post-to-zernio re-applies the America/Sao_Paulo timezone.
function spWallClock(y: number, moIdx: number, d: number, h: number, m: number): string {
  const mo = String(moIdx + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${y}-${mo}-${dd}T${hh}:${mm}:00`;
}

function computeNextSlot(times: string[], weekdays: number[]): string | null {
  return computeNextSlots(times, weekdays, 1)[0] ?? null;
}

// Returns up to `count` upcoming SP wall-clock slots from `times` × `weekdays`.
function computeNextSlots(times: string[], weekdays: number[], count: number): string[] {
  if (!times.length || !weekdays.length || count <= 0) return [];
  const sorted = [...times].sort();
  const minInstant = Date.now() + 5 * 60 * 1000;
  const nowSp = new Date(Date.now() - SP_OFFSET_HOURS * 3600 * 1000);
  const cursor = new Date(Date.UTC(nowSp.getUTCFullYear(), nowSp.getUTCMonth(), nowSp.getUTCDate()));
  const slots: string[] = [];
  for (let day = 0; day < 730 && slots.length < count; day++) {
    if (weekdays.includes(cursor.getUTCDay())) {
      const y = cursor.getUTCFullYear();
      const mo = cursor.getUTCMonth();
      const d = cursor.getUTCDate();
      for (const t of sorted) {
        if (slots.length >= count) break;
        const [h, m] = t.split(":").map(Number);
        const instant = Date.UTC(y, mo, d, h + SP_OFFSET_HOURS, m ?? 0, 0);
        if (instant < minInstant) continue;
        slots.push(spWallClock(y, mo, d, h, m ?? 0));
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slots;
}

function pickRandom<T>(items: T[] | null | undefined): T | null {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
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
