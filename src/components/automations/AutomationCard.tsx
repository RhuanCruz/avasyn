import { Icon, Pill } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import type { Automation, AutomationStatus } from "@/lib/types";

import { DAY_NAMES } from "./types";

type Props = {
  automation: Automation;
  postsToday: number;
  accountLabel: string | null;
  running: boolean;
  toggling: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onRun: () => void;
  onDetails: () => void;
  onPosts: () => void;
};

const STATUS_PILL: Record<AutomationStatus, { tone: "neutral" | "ok" | "warn" | "err"; label: string }> = {
  draft: { tone: "neutral", label: "Rascunho" },
  active: { tone: "ok", label: "Ativa" },
  paused: { tone: "warn", label: "Pausada" },
  error: { tone: "err", label: "Erro" },
};

export function AutomationCard({
  automation,
  postsToday,
  accountLabel,
  running,
  toggling,
  onEdit,
  onToggle,
  onRun,
  onDetails,
  onPosts,
}: Props) {
  const status = STATUS_PILL[automation.status] ?? STATUS_PILL.draft;
  const isActive = automation.status === "active";
  const queries = automation.search_queries?.filter(Boolean) ?? [];
  const nextLabel = isActive ? nextSlotLabel(automation.post_times, automation.days_of_week) : null;

  return (
    <div className="card card-pad" style={{ padding: 14 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <div className="flex items-center gap-2">
            <span className="text-md truncate">{automation.name}</span>
            <Pill tone={status.tone}>{status.label}</Pill>
          </div>
          <span className="truncate text-sm muted">{queries.join(" · ") || "Sem tema"}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button onClick={onRun} disabled={running} size="sm" variant="outline" title="Rodar agora — gera os vídeos dos próximos horários da semana">
            {running ? <Icon name="refresh" size={14} /> : <Icon name="play" size={14} />}
          </Button>
          <Button onClick={onToggle} disabled={toggling} size="sm" variant="outline" title={isActive ? "Pausar" : "Ativar"}>
            <Icon name={isActive ? "pause" : "play"} size={14} />
          </Button>
          <Button onClick={onEdit} size="sm" variant="outline" title="Editar">
            <Icon name="edit" size={14} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mt-3">
        <Pill tone="violet">{automation.reaction_pool?.length ?? 0} reaction{(automation.reaction_pool?.length ?? 0) !== 1 ? "s" : ""}</Pill>
        {(automation.days_of_week ?? []).map((d) => (
          <Pill key={d} tone="base">{DAY_NAMES[d]}</Pill>
        ))}
        {(automation.post_times ?? []).map((t) => (
          <Pill key={t} tone="base">{t}</Pill>
        ))}
        {accountLabel && <Pill tone="neutral"><Icon name="send" size={10} style={{ marginRight: 4 }} />{accountLabel}</Pill>}
      </div>

      <div className="flex items-center justify-between gap-2 mt-3">
        <div className="flex items-center gap-3 text-xs muted">
          <span>Hoje: {postsToday}/{automation.posts_per_day}</span>
          {nextLabel ? (
            <span className="flex items-center gap-1">
              <Icon name="clock" size={11} />
              Próxima execução: {nextLabel}
            </span>
          ) : isActive ? (
            <span>Sem próximo horário</span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <button className="text-xs" onClick={onPosts} type="button" style={{ color: "var(--accent-hover)" }}>
            Ver posts
          </button>
          <button className="text-xs" onClick={onDetails} type="button" style={{ color: "var(--accent-hover)" }}>
            Ver execuções
          </button>
        </div>
      </div>

      {automation.last_error_message && (
        <div className="flex items-center gap-2 text-xs mt-2" style={{ color: "var(--err)" }}>
          <Icon name="alert" size={12} />
          <span className="truncate">{automation.last_error_message}</span>
        </div>
      )}
    </div>
  );
}

const SP_OFFSET_HOURS = 3;

// Lightweight next-slot preview (America/Sao_Paulo) for the card.
function nextSlotLabel(times: string[] | null, weekdays: number[] | null): string | null {
  if (!times?.length || !weekdays?.length) return null;
  const sorted = [...times].filter(Boolean).sort();
  const minInstant = Date.now() + 5 * 60 * 1000;
  const nowSp = new Date(Date.now() - SP_OFFSET_HOURS * 3600 * 1000);
  const cursor = new Date(Date.UTC(nowSp.getUTCFullYear(), nowSp.getUTCMonth(), nowSp.getUTCDate()));
  for (let day = 0; day < 14; day++) {
    if (weekdays.includes(cursor.getUTCDay())) {
      for (const t of sorted) {
        const [h, m] = t.split(":").map(Number);
        const instant = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), h + SP_OFFSET_HOURS, m ?? 0, 0);
        if (instant < minInstant) continue;
        const isToday = day === 0;
        return `${isToday ? "hoje" : DAY_NAMES[cursor.getUTCDay()]} ${t}`;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return null;
}
