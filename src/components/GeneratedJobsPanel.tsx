import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Icon, StatusPill, formatDate } from "@/components/operator-ui";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { ReelJob, SocialAccount } from "@/lib/types";

export function GeneratedJobsPanel({
  accounts,
  jobIds,
  onScheduled,
}: {
  accounts: SocialAccount[];
  jobIds: string[];
  onScheduled: () => void;
}) {
  const [jobs, setJobs] = useState<ReelJob[]>([]);

  const refreshJobs = useCallback(async () => {
    if (jobIds.length === 0) {
      setJobs([]);
      return;
    }

    const { data, error } = await supabase
      .from("reel_jobs")
      .select("*")
      .in("id", jobIds)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(error.message);
      return;
    }

    setJobs((data ?? []) as ReelJob[]);
  }, [jobIds]);

  useEffect(() => {
    void refreshJobs();
    if (jobIds.length === 0) return;

    const interval = window.setInterval(() => {
      void refreshJobs();
    }, 4000);

    return () => window.clearInterval(interval);
  }, [jobIds.length, refreshJobs]);

  return (
    <section className="panel card-pad">
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h2 className="text-lg">05. Vídeos gerados e publicação</h2>
          <p className="page-subtitle">
            Aguarde a renderização, revise o vídeo final e só então escolha conta e agenda.
          </p>
        </div>
      </div>

      {jobIds.length === 0 ? (
        <div className="empty" style={{ padding: "40px 12px" }}>
          <div>
            <h3>Nenhum job criado ainda</h3>
            <p>Os vídeos renderizados vão aparecer aqui para publicação ou agendamento.</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {jobs.map((job) => (
            <GeneratedJobCard
              accounts={accounts}
              job={job}
              key={job.id}
              onScheduled={() => {
                void refreshJobs();
                onScheduled();
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GeneratedJobCard({
  accounts,
  job,
  onScheduled,
}: {
  accounts: SocialAccount[];
  job: ReelJob;
  onScheduled: () => void;
}) {
  const [accountId, setAccountId] = useState(job.account_id ?? "");
  const [scheduledFor, setScheduledFor] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function schedulePost() {
    setSubmitting(true);
    try {
      await invokeFunction("post-to-zernio", {
        jobId: job.id,
        accountId,
        scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      });
      toast.success(scheduledFor ? "Post agendado" : "Post enviado");
      onScheduled();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao agendar");
    } finally {
      setSubmitting(false);
    }
  }

  const canSchedule = job.status === "rendered" && Boolean(job.output_path);

  return (
    <div className="card card-pad">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="col" style={{ gap: 8, minWidth: 0, flex: 1 }}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill kind="job" status={job.status} />
            <span className="text-xs mono muted">{formatDate(job.created_at)}</span>
          </div>
          <div className="truncate text-sm">{job.clip_url}</div>
          {job.error_message ? (
            <div className="text-sm" style={{ color: "var(--err)" }}>
              {job.error_message}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {job.platform_post_url ? (
            <a
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm"
              href={job.platform_post_url}
              rel="noreferrer"
              target="_blank"
            >
              <Icon name="eye" />
              Ver post
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <StorageVideoPreview
          aspect="reel"
          bucket="generated-reels"
          path={job.output_path}
          title="Vídeo gerado"
        />
      </div>

      {canSchedule ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_auto] xl:items-end">
          <Field>
            <FieldLabel htmlFor={`account-${job.id}`}>Conta de destino</FieldLabel>
            <Select
              id={`account-${job.id}`}
              onChange={(event) => setAccountId(event.target.value)}
              required
              value={accountId}
            >
              <option value="">Selecione uma conta</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`schedule-${job.id}`}>Data e hora</FieldLabel>
            <Input
              id={`schedule-${job.id}`}
              onChange={(event) => setScheduledFor(event.target.value)}
              type="datetime-local"
              value={scheduledFor}
            />
            <FieldDescription>Deixe vazio para publicar imediatamente.</FieldDescription>
          </Field>
          <Button
            disabled={!accountId || submitting}
            onClick={() => void schedulePost()}
          >
            <Icon name="calendar" />
            {submitting ? "Enviando..." : scheduledFor ? "Agendar" : "Publicar"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
