import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ClipUrlPreview, StorageVideoPreview } from "@/components/VideoPreview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";
import { normalizeClipUrls } from "@/lib/job-utils";
import { supabase } from "@/lib/supabase";
import type { ReactionVideo, ReelJob, SocialAccount } from "@/lib/types";

type CreateJobsResponse = {
  jobs?: Array<{ id: string }>;
};

export function GeneratePage() {
  const [clipUrls, setClipUrls] = useState("");
  const [reactionId, setReactionId] = useState("");
  const [caption, setCaption] = useState("Melhor lance do dia #futebol");
  const [overlayText, setOverlayText] = useState("MELHOR LANCE DO DIA");
  const [submitting, setSubmitting] = useState(false);
  const [createdJobIds, setCreatedJobIds] = useState<string[]>([]);

  const previewUrls = useMemo(() => {
    try {
      return normalizeClipUrls(clipUrls);
    } catch {
      return [];
    }
  }, [clipUrls]);

  const loadAccounts = useCallback(async () => {
    const { data, error } = await supabase
      .from("social_accounts")
      .select("*")
      .eq("active", true)
      .order("display_name");

    if (error) throw error;
    return (data ?? []) as SocialAccount[];
  }, []);

  const loadReactions = useCallback(async () => {
    const { data, error } = await supabase
      .from("reaction_videos")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as ReactionVideo[];
  }, []);

  const accounts = useSupabaseQuery(loadAccounts, []);
  const reactions = useSupabaseQuery(loadReactions, []);
  const selectedReaction =
    reactions.data.find((reaction) => reaction.id === reactionId) ?? null;

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const urls = normalizeClipUrls(clipUrls);
      const response = await invokeFunction<CreateJobsResponse>("create-manual-jobs", {
        reactionId,
        caption,
        overlayText,
        clipUrls: urls,
      });
      const jobIds = response.jobs?.map((job) => job.id) ?? [];
      setCreatedJobIds(jobIds);
      toast.success(`${jobIds.length} job(s) enviados para renderização`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar jobs");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        description="Primeiro gere o vídeo. Depois escolha conta, data e horário para agendar."
        title="Gerar agora"
      />

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>1. Gerar vídeo</CardTitle>
            <CardDescription>
              Selecione a reaction, cole os clips e renderize antes de agendar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="reaction">Reaction</FieldLabel>
                  <Select
                    id="reaction"
                    onChange={(event) => setReactionId(event.target.value)}
                    required
                    value={reactionId}
                  >
                    <option value="">Selecione uma reaction</option>
                    {reactions.data.map((reaction) => (
                      <option key={reaction.id} value={reaction.id}>
                        {reaction.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                {selectedReaction ? (
                  <StorageVideoPreview
                    bucket="reaction-videos"
                    path={selectedReaction.storage_path}
                    title="Preview da reaction"
                  />
                ) : null}

                <Field>
                  <FieldLabel htmlFor="clipUrls">URLs dos clips</FieldLabel>
                  <Textarea
                    id="clipUrls"
                    onChange={(event) => setClipUrls(event.target.value)}
                    placeholder="https://youtube.com/shorts/..."
                    required
                    value={clipUrls}
                  />
                  <FieldDescription>Uma URL por linha.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="caption">Caption</FieldLabel>
                  <Textarea
                    id="caption"
                    onChange={(event) => setCaption(event.target.value)}
                    required
                    value={caption}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="overlayText">Texto da divisória</FieldLabel>
                  <Input
                    id="overlayText"
                    onChange={(event) => setOverlayText(event.target.value)}
                    required
                    value={overlayText}
                  />
                </Field>

                <Button disabled={submitting} type="submit">
                  {submitting ? "Gerando..." : "Gerar vídeo"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <ClipPreviewList urls={previewUrls} />
          <GeneratedJobsPanel
            accounts={accounts.data}
            jobIds={createdJobIds}
            onScheduled={() => setCreatedJobIds((current) => [...current])}
          />
        </div>
      </section>
    </>
  );
}

function ClipPreviewList({ urls }: { urls: string[] }) {
  if (urls.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Preview dos clips</CardTitle>
          <CardDescription>Os previews aparecem quando URLs válidas são coladas.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview dos clips</CardTitle>
        <CardDescription>Para links sem embed direto, abra o clip em outra aba.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {urls.map((url) => (
          <ClipUrlPreview key={url} url={url} />
        ))}
      </CardContent>
    </Card>
  );
}

function GeneratedJobsPanel({
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
