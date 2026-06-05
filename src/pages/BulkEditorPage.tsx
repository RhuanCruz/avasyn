import {
  Dispatch,
  FormEvent,
  SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { GeneratedJobsPanel } from "@/components/GeneratedJobsPanel";
import { PageHeader } from "@/components/PageHeader";
import { StorageVideoPreview } from "@/components/VideoPreview";
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
import { Textarea } from "@/components/ui/textarea";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase";
import type { ReactionVideo, SocialAccount, SourceVideo } from "@/lib/types";

type CreateJobsResponse = {
  jobs?: Array<{ id: string }>;
};

export function BulkEditorPage() {
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [selectedReactionIds, setSelectedReactionIds] = useState<string[]>([]);
  const [caption, setCaption] = useState("Melhor lance do dia #futebol");
  const [overlayText, setOverlayText] = useState("MELHOR LANCE DO DIA");
  const [creating, setCreating] = useState(false);
  const [createdJobIds, setCreatedJobIds] = useState<string[]>([]);

  const loadSourceVideos = useCallback(async () => {
    const { data, error } = await supabase
      .from("source_videos")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as SourceVideo[];
  }, []);

  const loadReactions = useCallback(async () => {
    const { data, error } = await supabase
      .from("reaction_videos")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as ReactionVideo[];
  }, []);

  const loadAccounts = useCallback(async () => {
    const { data, error } = await supabase
      .from("social_accounts")
      .select("*")
      .eq("active", true)
      .order("display_name");

    if (error) throw error;
    return (data ?? []) as SocialAccount[];
  }, []);

  const sourceVideos = useSupabaseQuery(loadSourceVideos, []);
  const reactions = useSupabaseQuery(loadReactions, []);
  const accounts = useSupabaseQuery(loadAccounts, []);
  const totalCombinations = selectedSourceIds.length * selectedReactionIds.length;
  const selectedSourceVideos = useMemo(
    () => sourceVideos.data.filter((video) => selectedSourceIds.includes(video.id)),
    [sourceVideos.data, selectedSourceIds],
  );
  const selectedReactions = useMemo(
    () => reactions.data.filter((reaction) => selectedReactionIds.includes(reaction.id)),
    [reactions.data, selectedReactionIds],
  );

  async function handleCreateJobs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);

    try {
      const response = await invokeFunction<CreateJobsResponse>("create-bulk-jobs", {
        sourceVideoIds: selectedSourceIds,
        reactionIds: selectedReactionIds,
        caption,
        overlayText,
      });
      const jobIds = response.jobs?.map((job) => job.id) ?? [];
      setCreatedJobIds(jobIds);
      toast.success(`${jobIds.length} job(s) enviados para renderização`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar jobs");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageHeader
        action={
          <Link
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            to="/library"
          >
            Abrir biblioteca
          </Link>
        }
        description="Selecione vídeos da biblioteca e gere combinações com suas reactions."
        title="Editor em massa"
      />

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="flex flex-col gap-4">
          <SourceVideoGrid
            error={sourceVideos.error}
            onToggle={(id) => toggleId(id, setSelectedSourceIds)}
            selectedIds={selectedSourceIds}
            videos={sourceVideos.data}
          />
          <ReactionSelection
            onToggle={(id) => toggleId(id, setSelectedReactionIds)}
            reactions={reactions.data}
            selectedIds={selectedReactionIds}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Criar combinações</CardTitle>
              <CardDescription>
                {totalCombinations === 0
                  ? "Selecione vídeos e reactions para calcular a fila."
                  : `${selectedSourceIds.length} vídeos x ${selectedReactionIds.length} reactions = ${totalCombinations} jobs.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateJobs}>
                <FieldGroup>
                  <SelectedSummary
                    reactions={selectedReactions}
                    sourceVideos={selectedSourceVideos}
                  />

                  <Field>
                    <FieldLabel htmlFor="bulk-caption">Caption</FieldLabel>
                    <Textarea
                      id="bulk-caption"
                      onChange={(event) => setCaption(event.target.value)}
                      required
                      value={caption}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="bulk-overlay">Texto da divisória</FieldLabel>
                    <Input
                      id="bulk-overlay"
                      onChange={(event) => setOverlayText(event.target.value)}
                      required
                      value={overlayText}
                    />
                    <FieldDescription>
                      O agendamento continua depois que cada vídeo for renderizado.
                    </FieldDescription>
                  </Field>

                  <Button
                    disabled={creating || totalCombinations === 0 || totalCombinations > 100}
                    type="submit"
                  >
                    {creating ? "Criando jobs..." : "Criar combinações"}
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

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

function SourceVideoGrid({
  error,
  onToggle,
  selectedIds,
  videos,
}: {
  error: string | null;
  onToggle: (id: string) => void;
  selectedIds: string[];
  videos: SourceVideo[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vídeos de lance</CardTitle>
        <CardDescription>Selecione os arquivos que entram nas combinações.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            Erro ao carregar vídeos: {error}
          </div>
        ) : null}

        {videos.length === 0 && !error ? (
          <div className="rounded-md border border-border p-8 text-sm text-muted-foreground">
            Nenhum vídeo na biblioteca. <Link className="underline underline-offset-4" to="/library">Adicionar mídias</Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {videos.map((video) => {
              const selected = selectedIds.includes(video.id);

              return (
                <article
                  className={cn(
                    "flex flex-col gap-3 rounded-md border border-border p-3",
                    selected && "ring-2 ring-ring",
                  )}
                  key={video.id}
                >
                  <StorageVideoPreview
                    bucket="source-videos"
                    path={video.storage_path}
                    title={video.name}
                  />
                  <Button
                    onClick={() => onToggle(video.id)}
                    type="button"
                    variant={selected ? "default" : "outline"}
                  >
                    {selected ? "Selecionado" : "Selecionar"}
                  </Button>
                </article>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReactionSelection({
  onToggle,
  reactions,
  selectedIds,
}: {
  onToggle: (id: string) => void;
  reactions: ReactionVideo[];
  selectedIds: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reactions</CardTitle>
        <CardDescription>Selecione uma ou mais reactions para combinar.</CardDescription>
      </CardHeader>
      <CardContent>
        {reactions.length === 0 ? (
          <div className="rounded-md border border-border p-8 text-sm text-muted-foreground">
            Nenhuma reaction enviada.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {reactions.map((reaction) => {
              const selected = selectedIds.includes(reaction.id);

              return (
                <article
                  className={cn(
                    "flex flex-col gap-3 rounded-md border border-border p-3",
                    selected && "ring-2 ring-ring",
                  )}
                  key={reaction.id}
                >
                  <StorageVideoPreview
                    bucket="reaction-videos"
                    path={reaction.storage_path}
                    title={reaction.name}
                  />
                  <Button
                    onClick={() => onToggle(reaction.id)}
                    type="button"
                    variant={selected ? "default" : "outline"}
                  >
                    {selected ? "Selecionada" : "Selecionar"}
                  </Button>
                </article>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SelectedSummary({
  reactions,
  sourceVideos,
}: {
  reactions: ReactionVideo[];
  sourceVideos: SourceVideo[];
}) {
  if (sourceVideos.length === 0 && reactions.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      {sourceVideos.length > 0 ? (
        <div>
          <p className="text-sm font-medium">Vídeos selecionados</p>
          {sourceVideos.map((video) => (
            <p className="truncate text-sm text-muted-foreground" key={video.id}>
              {video.name}
            </p>
          ))}
        </div>
      ) : null}
      {reactions.length > 0 ? (
        <div>
          <p className="text-sm font-medium">Reactions selecionadas</p>
          {reactions.map((reaction) => (
            <p className="truncate text-sm text-muted-foreground" key={reaction.id}>
              {reaction.name}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function toggleId(
  id: string,
  setIds: Dispatch<SetStateAction<string[]>>,
) {
  setIds((current) =>
    current.includes(id)
      ? current.filter((currentId) => currentId !== id)
      : [...current, id],
  );
}
