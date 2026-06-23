import type {
  Automation,
  AutomationApprovalMode,
  AutomationOverlayMode,
  AutomationTextMode,
} from "@/lib/types";

// Editable draft used by the wizard. Mirrors the columns the UI controls.
export type AutomationDraft = {
  name: string;
  search_queries: string[];
  source_platforms: string[];
  min_view_count: number;
  max_duration_s: number;
  recent_days: number;
  reaction_pool: string[];
  overlay_mode: AutomationOverlayMode;
  overlay_text: string;
  overlay_ideas: string[];
  overlay_ai_instructions: string;
  caption_mode: AutomationTextMode;
  caption_template: string;
  caption_ideas: string[];
  caption_ai_instructions: string;
  account_ids: string[];
  days_of_week: number[];
  post_times: string[];
  timezone: string;
  share_to_feed: boolean;
  approval_mode: AutomationApprovalMode;
};

export const DEFAULT_OVERLAY_IDEAS = ["Olha isso", "Que lance", "Sem reação", "Muito bom"];
export const DEFAULT_CAPTION_IDEAS = [
  "React novo no ar.",
  "Esse lance rendeu.",
  "Mais um react pra conta.",
];

export const MAX_QUERIES = 10;
// App-level cap: at most 5 posts (= 5 time slots) per day.
export const MAX_POSTS_PER_DAY = 5;

export function emptyDraft(): AutomationDraft {
  return {
    name: "",
    search_queries: [],
    source_platforms: ["youtube"],
    min_view_count: 0,
    max_duration_s: 90,
    recent_days: 14,
    reaction_pool: [],
    overlay_mode: "ideas",
    overlay_text: "",
    overlay_ideas: [...DEFAULT_OVERLAY_IDEAS],
    overlay_ai_instructions: "",
    caption_mode: "ideas",
    caption_template: "",
    caption_ideas: [...DEFAULT_CAPTION_IDEAS],
    caption_ai_instructions: "",
    account_ids: [],
    days_of_week: [1, 3, 5],
    post_times: ["09:00", "18:00"],
    timezone: "America/Sao_Paulo",
    share_to_feed: true,
    approval_mode: "auto",
  };
}

export function draftFromAutomation(a: Automation): AutomationDraft {
  const accountIds = a.account_ids?.length
    ? a.account_ids
    : a.account_id
      ? [a.account_id]
      : [];
  return {
    name: a.name ?? "",
    search_queries: a.search_queries ?? [],
    source_platforms: a.source_platforms?.length ? a.source_platforms : ["youtube"],
    min_view_count: a.min_view_count ?? 0,
    max_duration_s: a.max_duration_s ?? 90,
    recent_days: a.recent_days ?? 14,
    reaction_pool: a.reaction_pool ?? [],
    overlay_mode: a.overlay_mode ?? "ideas",
    overlay_text: a.overlay_text ?? "",
    overlay_ideas: a.overlay_ideas?.length ? a.overlay_ideas : [...DEFAULT_OVERLAY_IDEAS],
    overlay_ai_instructions: a.overlay_ai_instructions ?? "",
    caption_mode: a.caption_mode ?? "ideas",
    caption_template: a.caption_template ?? "",
    caption_ideas: a.caption_ideas?.length ? a.caption_ideas : [...DEFAULT_CAPTION_IDEAS],
    caption_ai_instructions: a.caption_ai_instructions ?? "",
    account_ids: accountIds,
    days_of_week: a.days_of_week ?? [],
    post_times: a.post_times ?? [],
    timezone: a.timezone ?? "America/Sao_Paulo",
    share_to_feed: a.share_to_feed ?? true,
    approval_mode: a.approval_mode ?? "auto",
  };
}

// Normalize a draft into the row payload sent to the `automations` table.
export function draftToRow(draft: AutomationDraft) {
  const queries = draft.search_queries
    .map((q) => q.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, MAX_QUERIES);
  const times = Array.from(new Set(draft.post_times.map((t) => t.trim()).filter(Boolean)))
    .sort()
    .slice(0, MAX_POSTS_PER_DAY);
  const overlayMode = draft.overlay_mode;
  return {
    name: draft.name.trim() || "Automação react()",
    search_queries: queries,
    source_platforms: draft.source_platforms.length ? draft.source_platforms : ["youtube"],
    min_view_count: Math.max(0, Math.trunc(draft.min_view_count || 0)),
    max_duration_s: Math.max(1, Math.trunc(draft.max_duration_s || 90)),
    recent_days: Math.max(1, Math.trunc(draft.recent_days || 14)),
    reaction_pool: draft.reaction_pool,
    overlay_mode: overlayMode,
    overlay_text: overlayMode === "fixed" ? draft.overlay_text.trim() : "",
    overlay_ideas: overlayMode === "ideas" ? draft.overlay_ideas.map((s) => s.trim()).filter(Boolean) : [],
    overlay_ai_instructions: overlayMode === "ai" ? draft.overlay_ai_instructions.trim() : "",
    caption_mode: draft.caption_mode,
    caption_template: draft.caption_template.trim(),
    caption_ideas: draft.caption_ideas.map((s) => s.trim()).filter(Boolean),
    caption_ai_instructions: draft.caption_mode === "ai" ? draft.caption_ai_instructions.trim() : "",
    account_ids: draft.account_ids,
    account_id: draft.account_ids[0] ?? null,
    days_of_week: [...draft.days_of_week].sort((a, b) => a - b),
    post_times: times,
    timezone: draft.timezone,
    // The number of post times IS the number of posts per day (capped at 5).
    posts_per_day: Math.max(1, Math.min(MAX_POSTS_PER_DAY, times.length || 1)),
    share_to_feed: draft.share_to_feed,
    approval_mode: draft.approval_mode,
  };
}

// Returns the list of missing requirements that block activation.
export function activationBlockers(draft: AutomationDraft): string[] {
  const blockers: string[] = [];
  if (draft.account_ids.length === 0) blockers.push("conta social");
  if (draft.reaction_pool.length === 0) blockers.push("reaction");
  if (draft.search_queries.filter((q) => q.trim()).length === 0) blockers.push("tema de busca");
  if (draft.days_of_week.length === 0) blockers.push("dias da semana");
  if (draft.post_times.filter((t) => t.trim()).length === 0) blockers.push("horários");
  if (draft.caption_mode === "fixed" && !draft.caption_template.trim()) blockers.push("legenda");
  if (draft.approval_mode === "review") blockers.push("modo revisão (indisponível no MVP)");
  return blockers;
}

export type AutomationRow = ReturnType<typeof draftToRow>;

export const DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Format a view count into pt-BR grouped digits ("1.000.000") for the masked input.
export function formatViewCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return Math.trunc(n).toLocaleString("pt-BR");
}

// Short abbreviation ("1,2 mi") for the helper label under the views input.
export function abbreviateViews(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "qualquer";
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return String(Math.trunc(n));
}
