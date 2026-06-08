import { FormEvent, useCallback, useMemo, useState } from "react";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase";
import type { ReactionVideo, SocialAccount, TikTokSearchResult } from "@/lib/types";

type SearchTikTokResponse = {
  cached?: boolean;
  query?: string;
  results?: TikTokSearchResult[];
};

type CreateJobsResponse = {
  jobs?: Array<{ id: string }>;
};

export function CuratePage() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<TikTokSearchResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reactionId, setReactionId] = useState("");
  const [caption, setCaption] = useState("Melhor lance do dia #futebol");
  const [overlayText, setOverlayText] = useState("MELHOR LANCE DO DIA");
  const [creating, setCreating] = useState(false);
  const [createdJobIds, setCreatedJobIds] = useState<string[]>([]);

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
  const selectedResults = useMemo(
    () => results.filter((result) => selectedIds.includes(result.id)),
    [results, selectedIds],
  );

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setCreatedJobIds([]);

    try {
      const response = await invokeFunction<SearchTikTokResponse>("search-tiktok", {
        query,
        limit: 12,
      });
      const nextResults = response.results ?? [];
      setResults(nextResults);
      setSelectedIds([]);
      toast.success(
        nextResults.length === 1
          ? "1 clip encontrado"
          : `${nextResults.length} clips encontrados`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao buscar no TikTok");
    } finally {
      setSearching(false);
    }
  }

  async function handleCreateJobs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);

    try {
      const response = await invokeFunction<CreateJobsResponse>("create-curated-jobs", {
        resultIds: selectedIds,
        reactionId,
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

  function toggleSelection(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id],
    );
  }

  return (
    <>
      <PageHeader
        description="Busque clips no TikTok, selecione os resultados e gere os vídeos depois."
        title="Curadoria TikTok"
      />

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>1. Buscar clips</CardTitle>
              <CardDescription>
                A busca retorna metadados e thumbnails. O download acontece só após confirmar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSearch}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="tiktok-query">Query</FieldLabel>
                    <Input
                      id="tiktok-query"
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="gol bicicleta meme"
                      required
                      value={query}
                    />
                  </Field>
                  <Button disabled={searching} type="submit">
                    {searching ? "Buscando..." : "Buscar no TikTok"}
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          <TikTokResultsGrid
            results={results}
            selectedIds={selectedIds}
            onToggleSelection={toggleSelection}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>2. Confirmar seleção</CardTitle>
              <CardDescription>
                {selectedIds.length === 0
                  ? "Selecione um ou mais clips para criar jobs."
                  : `${selectedIds.length} clip(s) selecionado(s).`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateJobs}>
                <FieldGroup>
                  {selectedResults.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {selectedResults.map((result) => (
                        <p className="truncate text-sm" key={result.id}>
                          {result.title ?? result.result_url}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  <Field>
                    <FieldLabel htmlFor="curate-reaction">Reaction</FieldLabel>
                    <Select
                      id="curate-reaction"
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
                    <FieldLabel htmlFor="curate-caption">Caption</FieldLabel>
                    <Textarea
                      id="curate-caption"
                      onChange={(event) => setCaption(event.target.value)}
                      required
                      value={caption}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="curate-overlay">Texto da divisória</FieldLabel>
                    <Input
                      id="curate-overlay"
                      onChange={(event) => setOverlayText(event.target.value)}
                      required
                      value={overlayText}
                    />
                    <FieldDescription>
                      Conta, data e horário são escolhidos depois do vídeo renderizado.
                    </FieldDescription>
                  </Field>

                  <Button
                    disabled={creating || selectedIds.length === 0}
                    type="submit"
                  >
                    {creating ? "Criando jobs..." : "Criar jobs"}
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          <GeneratedJobsPanel
            jobIds={createdJobIds}
          />
        </div>
      </section>
    </>
  );
}

function TikTokResultsGrid({
  results,
  selectedIds,
  onToggleSelection,
}: {
  results: TikTokSearchResult[];
  selectedIds: string[];
  onToggleSelection: (id: string) => void;
}) {
  if (results.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Resultados</CardTitle>
          <CardDescription>Os clips aparecem aqui depois da busca.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resultados</CardTitle>
        <CardDescription>Selecione os clips que devem entrar na fila.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {results.map((result) => {
          const selected = selectedIds.includes(result.id);

          return (
            <article
              className={cn(
                "flex flex-col gap-3 rounded-md border border-border p-3",
                selected && "ring-2 ring-ring",
              )}
              key={result.id}
            >
              <div className="aspect-[9/12] overflow-hidden rounded-md border border-border bg-muted">
                {result.thumbnail_url ? (
                  <img
                    alt={result.title ?? "Thumbnail do TikTok"}
                    className="size-full object-cover"
                    loading="lazy"
                    src={result.thumbnail_url}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                    Sem thumbnail
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <h3 className="line-clamp-2 text-sm font-medium leading-snug">
                  {result.title ?? "Sem título"}
                </h3>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{formatViews(result.view_count)}</span>
                  <span>{formatDuration(result.duration_s)}</span>
                  {result.uploader ? <span>{result.uploader}</span> : null}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => onToggleSelection(result.id)}
                  type="button"
                  variant={selected ? "default" : "outline"}
                >
                  {selected ? "Selecionado" : "Selecionar"}
                </Button>
                <Button
                  onClick={() => window.open(result.result_url, "_blank", "noreferrer")}
                  type="button"
                  variant="outline"
                >
                  Abrir
                </Button>
              </div>
            </article>
          );
        })}
      </CardContent>
    </Card>
  );
}

function formatViews(value: number | null) {
  if (value === null) return "views indisponíveis";
  return `${Intl.NumberFormat("pt-BR", { notation: "compact" }).format(value)} views`;
}

function formatDuration(value: number | null) {
  if (value === null) return "duração indisponível";

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
