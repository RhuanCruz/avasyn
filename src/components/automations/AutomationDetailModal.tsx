import { useCallback } from "react";

import { Icon, Pill } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import type { Automation, AutomationCandidate, AutomationRun } from "@/lib/types";

type Props = {
  automation: Automation;
  onClose: () => void;
};

const RUN_TONE: Record<string, "neutral" | "ok" | "warn" | "err" | "info"> = {
  pending: "neutral",
  searching: "info",
  reserved: "info",
  job_created: "ok",
  no_candidate: "warn",
  error: "err",
};

const CANDIDATE_LABEL: Record<string, string> = {
  found: "encontrado",
  reserved: "usado",
  skipped_used: "repetido",
  skipped_filter: "filtrado",
  failed: "erro",
};

const SKIP_REASON_LABEL: Record<string, string> = {
  duration: "duração",
  min_views: "views",
  already_used: "já usado",
};

function candidateLabel(c: AutomationCandidate): string {
  const base = CANDIDATE_LABEL[c.status] ?? c.status;
  if (c.status === "skipped_filter" && c.skip_reason) {
    return `${base} · ${SKIP_REASON_LABEL[c.skip_reason] ?? c.skip_reason}`;
  }
  return base;
}

export function AutomationDetailModal({ automation, onClose }: Props) {
  const loadRuns = useCallback(async (): Promise<AutomationRun[]> => {
    const { data, error } = await supabase
      .from("automation_runs")
      .select("*")
      .eq("automation_id", automation.id)
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return (data ?? []) as AutomationRun[];
  }, [automation.id]);

  const loadCandidates = useCallback(async (): Promise<AutomationCandidate[]> => {
    const { data, error } = await supabase
      .from("automation_candidates")
      .select("*")
      .eq("automation_id", automation.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return (data ?? []) as AutomationCandidate[];
  }, [automation.id]);

  const runs = useSupabaseQuery(loadRuns, []);
  const candidates = useSupabaseQuery(loadCandidates, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div className="panel wizard-panel" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-header">
          <div className="col" style={{ gap: 4 }}>
            <h2 className="text-lg">{automation.name}</h2>
            <p className="text-sm muted">Execuções e candidatos recentes</p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>

        <div className="wizard-body col" style={{ gap: 20 }}>
          <section className="col" style={{ gap: 8 }}>
            <div className="text-md">Execuções</div>
            {runs.loading ? (
              <p className="text-sm muted">Carregando…</p>
            ) : runs.data.length === 0 ? (
              <p className="text-sm muted">Nenhuma execução ainda.</p>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {runs.data.map((run) => (
                  <div className="flex items-center gap-3 text-sm" key={run.id}>
                    <Pill tone={RUN_TONE[run.status] ?? "neutral"}>{run.status}</Pill>
                    <span className="text-xs muted">{formatDate(run.started_at)}</span>
                    {run.query && <span className="truncate text-xs">{run.query}</span>}
                    {run.error_message && (
                      <span className="truncate text-xs" style={{ color: "var(--err)" }}>{run.error_message}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="col" style={{ gap: 8 }}>
            <div className="text-md">Candidatos</div>
            {candidates.loading ? (
              <p className="text-sm muted">Carregando…</p>
            ) : candidates.data.length === 0 ? (
              <p className="text-sm muted">Nenhum candidato registrado.</p>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {candidates.data.map((c) => (
                  <div className="flex items-center gap-3 text-sm" key={c.id}>
                    <Pill tone={c.status === "reserved" ? "ok" : c.status.startsWith("skipped") ? "warn" : "neutral"}>
                      {candidateLabel(c)}
                    </Pill>
                    <span className="truncate text-xs flex-1">{c.title ?? c.source_url}</span>
                    {c.view_count != null && <span className="text-xs muted">{formatViews(c.view_count)}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const d = new Date(value);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}
