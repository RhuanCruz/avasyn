import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/StatusBadge";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

  if (jobIds.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>2. Agendar postagem</CardTitle>
          <CardDescription>
            Depois da renderização, o vídeo final aparece aqui para agendar.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>2. Vídeos gerados e agendamento</CardTitle>
        <CardDescription>
          Aguarde o status renderizado, confira o vídeo final e escolha conta/data.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
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
      </CardContent>
    </Card>
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
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="truncate text-sm font-medium">{job.clip_url}</p>
          {job.error_message ? (
            <p className="mt-1 text-sm text-muted-foreground">{job.error_message}</p>
          ) : null}
        </div>
        <StatusBadge status={job.status} />
      </div>

      <StorageVideoPreview
        bucket="generated-reels"
        path={job.output_path}
        title="Vídeo gerado"
      />

      {canSchedule ? (
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <Field>
            <FieldLabel htmlFor={`account-${job.id}`}>Conta</FieldLabel>
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
            <FieldDescription>Vazio publica imediatamente.</FieldDescription>
          </Field>
          <Button
            disabled={!accountId || submitting}
            onClick={() => void schedulePost()}
          >
            {submitting ? "Agendando..." : scheduledFor ? "Agendar" : "Publicar"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
