import { FormEvent, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { GeneratedJobsPanel } from "@/components/GeneratedJobsPanel";
import { PageHeader } from "@/components/PageHeader";
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
import type { ReactionVideo, SocialAccount } from "@/lib/types";

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
