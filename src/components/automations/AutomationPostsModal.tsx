import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Icon, Pill } from "@/components/operator-ui";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { Button } from "@/components/ui/button";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Automation, JobStatus, ReelJob } from "@/lib/types";

type Props = {
  automation: Automation;
  onClose: () => void;
};

const STATUS: Record<JobStatus, { tone: "neutral" | "info" | "ok" | "warn" | "err"; label: string }> = {
  pending: { tone: "neutral", label: "Na fila" },
  processing: { tone: "info", label: "Renderizando" },
  rendered: { tone: "info", label: "Renderizado" },
  posting: { tone: "warn", label: "Agendado" },
  posted: { tone: "ok", label: "Publicado" },
  error: { tone: "err", label: "Erro" },
};

export function AutomationPostsModal({ automation, onClose }: Props) {
  const loadJobs = useCallback(async (): Promise<ReelJob[]> => {
    const { data, error } = await supabase
      .from("reel_jobs")
      .select("*")
      .eq("automation_id", automation.id)
      .order("scheduled_post_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as ReelJob[];
  }, [automation.id]);

  const jobs = useSupabaseQuery(loadJobs, []);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function retry(jobId: string) {
    setRetrying(jobId);
    try {
      await invokeFunction("retry-failed-jobs", { jobId });
      toast.success("Reenfileirado — renderizando de novo");
      await jobs.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao reenfileirar");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div className="panel wizard-panel" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-header">
          <div className="col" style={{ gap: 4 }}>
            <h2 className="text-lg">{automation.name}</h2>
            <p className="text-sm muted">Posts gerados por esta automação</p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>

        <div className="wizard-body">
          {jobs.loading ? (
            <p className="text-sm muted">Carregando…</p>
          ) : jobs.data.length === 0 ? (
            <div className="empty" style={{ padding: "32px 12px" }}>
              <div>
                <h3>Nenhum post ainda</h3>
                <p>Use "Rodar agora" para gerar os vídeos dos próximos horários.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              {jobs.data.map((job) => {
                const status = STATUS[job.status] ?? STATUS.pending;
                const rendered = job.output_path && (job.status === "rendered" || job.status === "posting" || job.status === "posted");
                return (
                  <div className="card card-pad" key={job.id} style={{ padding: 8 }}>
                    <div style={{ position: "relative" }}>
                      {rendered ? (
                        <StorageVideoPreview
                          aspect="reel"
                          bucket="generated-reels"
                          path={job.output_path!}
                          showTitle={false}
                          title={job.caption}
                        />
                      ) : (
                        <div
                          className="flex items-center justify-center aspect-[9/16] rounded-md"
                          style={{ background: "var(--surface-2)" }}
                        >
                          <Icon name="film" size={20} style={{ opacity: 0.5 }} />
                        </div>
                      )}
                      <div style={{ position: "absolute", top: 6, left: 6 }}>
                        <Pill tone={status.tone}>{status.label}</Pill>
                      </div>
                    </div>
                    {job.overlay_text && <p className="truncate text-xs mt-2">{job.overlay_text}</p>}
                    <p className="text-xs muted mt-1" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {job.caption}
                    </p>
                    {job.scheduled_post_at && (
                      <p className="text-xs muted mt-1">{formatSlot(job.scheduled_post_at)}</p>
                    )}
                    {job.error_message && (
                      <p className="text-xs mt-1" style={{ color: "var(--err)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {job.error_message}
                      </p>
                    )}
                    {job.status === "error" && (
                      <Button
                        className="mt-2 w-full"
                        disabled={retrying === job.id}
                        onClick={() => void retry(job.id)}
                        size="sm"
                        variant="outline"
                      >
                        <Icon name="refresh" size={12} style={{ marginRight: 4 }} />
                        {retrying === job.id ? "Reenfileirando…" : "Tentar de novo"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// scheduled_post_at is stored as SP wall-clock (no offset); show the digits as-is.
function formatSlot(value: string): string {
  const m = value.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return value;
  return `${m[3]}/${m[2]} ${m[4]}:${m[5]}`;
}
