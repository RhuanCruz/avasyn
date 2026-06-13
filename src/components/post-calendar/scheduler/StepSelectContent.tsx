import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Icon, Pill } from "@/components/operator-ui";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { ContentSearchResult, ReelJob, SourceVideo } from "@/lib/types";

import type { ScheduleItem } from "./types";

type Tab = "prontos" | "biblioteca" | "buscar";

type Props = {
  avatarId: string;
  initialItems: ScheduleItem[];
  onNext: (items: ScheduleItem[]) => void;
};

type SearchResponse = {
  results: ContentSearchResult[];
};

export function StepSelectContent({ avatarId, initialItems, onNext }: Props) {
  const [tab, setTab] = useState<Tab>("prontos");
  const [selected, setSelected] = useState<ScheduleItem[]>(initialItems);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ContentSearchResult[]>([]);

  const loadRendered = useCallback(async (): Promise<ReelJob[]> => {
    const { data, error } = await supabase
      .from("reel_jobs")
      .select("*")
      .eq("avatar_id", avatarId)
      .eq("status", "rendered")
      .is("scheduled_post_at", null)
      .not("output_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as ReelJob[];
  }, [avatarId]);

  const loadLibrary = useCallback(async (): Promise<SourceVideo[]> => {
    const { data, error } = await supabase
      .from("source_videos")
      .select("*")
      .eq("avatar_id", avatarId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as SourceVideo[];
  }, [avatarId]);

  const renderedQuery = useSupabaseQuery(loadRendered, []);
  const libraryQuery = useSupabaseQuery(loadLibrary, []);

  const selectedIds = new Set(
    selected.map((item) =>
      item.kind === "rendered_job" ? item.jobId :
      item.kind === "library" ? item.sourceVideoId :
      item.url
    )
  );

  function toggleRendered(job: ReelJob) {
    const id = job.id;
    setSelected((prev) =>
      selectedIds.has(id)
        ? prev.filter((item) => !(item.kind === "rendered_job" && item.jobId === id))
        : [...prev, { kind: "rendered_job", jobId: id, label: job.caption || job.clip_url, thumbPath: job.output_path ?? undefined }]
    );
  }

  function toggleLibrary(video: SourceVideo) {
    const id = video.id;
    setSelected((prev) =>
      selectedIds.has(id)
        ? prev.filter((item) => !(item.kind === "library" && item.sourceVideoId === id))
        : [...prev, { kind: "library", sourceVideoId: id, label: video.name, storagePath: video.storage_path }]
    );
  }

  function toggleSearch(result: ContentSearchResult) {
    const url = result.result_url;
    setSelected((prev) =>
      selectedIds.has(url)
        ? prev.filter((item) => !(item.kind === "url" && item.url === url))
        : [...prev, { kind: "url", url, label: result.title ?? url, thumbnailUrl: result.thumbnail_url }]
    );
  }

  async function handleSearch() {
    if (searchQuery.trim().length < 2) {
      toast.error("Digite ao menos 2 caracteres");
      return;
    }
    setSearching(true);
    try {
      const resp = await invokeFunction<SearchResponse>("search-content", {
        avatarId,
        query: searchQuery.trim(),
        platforms: ["youtube", "tiktok"],
        recentDays: 30,
      });
      setSearchResults(resp.results ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na busca");
    } finally {
      setSearching(false);
    }
  }

  const rawCount = selected.filter((item) => item.kind !== "rendered_job").length;
  const renderedCount = selected.filter((item) => item.kind === "rendered_job").length;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="tabs" style={{ marginTop: 0 }}>
        {(["prontos", "biblioteca", "buscar"] as Tab[]).map((t) => (
          <button
            className={`tab ${tab === t ? "active" : ""}`}
            key={t}
            onClick={() => setTab(t)}
            type="button"
          >
            {t === "prontos" ? "Prontos" : t === "biblioteca" ? "Biblioteca" : "Buscar"}
          </button>
        ))}
      </div>

      {tab === "prontos" && (
        <div>
          {renderedQuery.loading ? (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton className="aspect-[9/16] rounded-md" key={i} />
              ))}
            </div>
          ) : renderedQuery.data.length === 0 ? (
            <div className="empty" style={{ padding: "32px 12px" }}>
              <div>
                <h3>Nenhum reel pronto</h3>
                <p>Reels já renderizados e ainda não agendados aparecem aqui.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              {renderedQuery.data.map((job) => {
                const isSelected = selectedIds.has(job.id);
                return (
                  <button
                    className={`content-select-card ${isSelected ? "selected" : ""}`}
                    key={job.id}
                    onClick={() => toggleRendered(job)}
                    type="button"
                  >
                    {job.output_path ? (
                      <StorageVideoPreview
                        aspect="reel"
                        bucket="generated-reels"
                        path={job.output_path}
                        showTitle={false}
                        title={job.caption}
                      />
                    ) : null}
                    {isSelected && (
                      <div className="content-select-check">
                        <Icon name="check" size={14} />
                      </div>
                    )}
                    <p className="truncate text-xs mt-1 muted">{job.caption || "Sem legenda"}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "biblioteca" && (
        <div>
          {libraryQuery.loading ? (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton className="aspect-[9/16] rounded-md" key={i} />
              ))}
            </div>
          ) : libraryQuery.data.length === 0 ? (
            <div className="empty" style={{ padding: "32px 12px" }}>
              <div>
                <h3>Biblioteca vazia</h3>
                <p>Adicione vídeos à biblioteca deste avatar primeiro.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              {libraryQuery.data.map((video) => {
                const isSelected = selectedIds.has(video.id);
                return (
                  <button
                    className={`content-select-card ${isSelected ? "selected" : ""}`}
                    key={video.id}
                    onClick={() => toggleLibrary(video)}
                    type="button"
                  >
                    <StorageVideoPreview
                      aspect="reel"
                      bucket="source-videos"
                      path={video.storage_path}
                      showTitle={false}
                      title={video.name}
                    />
                    {isSelected && (
                      <div className="content-select-check">
                        <Icon name="check" size={14} />
                      </div>
                    )}
                    <p className="truncate text-xs mt-1 muted">{video.name}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "buscar" && (
        <div className="col" style={{ gap: 12 }}>
          <div className="flex gap-2">
            <input
              className="input"
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSearch(); }}
              placeholder="Ex: football shorts, gol bicicleta..."
              value={searchQuery}
            />
            <Button disabled={searching} onClick={() => void handleSearch()}>
              {searching ? "Buscando..." : "Buscar"}
            </Button>
          </div>

          {searchResults.length === 0 && !searching ? (
            <div className="empty" style={{ padding: "32px 12px" }}>
              <div>
                <Icon name="search" size={32} style={{ color: "var(--text-muted)", marginBottom: 8 }} />
                <h3>Busque vídeos</h3>
                <p>Digite um termo acima para buscar conteúdo do YouTube e TikTok.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              {searching
                ? Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton className="aspect-[9/16] rounded-md" key={i} />
                  ))
                : searchResults.map((result) => {
                    const isSelected = selectedIds.has(result.result_url);
                    return (
                      <button
                        className={`content-select-card ${isSelected ? "selected" : ""}`}
                        key={result.id}
                        onClick={() => toggleSearch(result)}
                        type="button"
                      >
                        <div className="aspect-[9/16] w-full overflow-hidden rounded-md border border-border bg-secondary flex items-center justify-center">
                          {result.thumbnail_url ? (
                            <img
                              alt={result.title ?? ""}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              src={result.thumbnail_url}
                            />
                          ) : (
                            <Icon name="video" size={24} style={{ color: "var(--text-muted)" }} />
                          )}
                        </div>
                        {isSelected && (
                          <div className="content-select-check">
                            <Icon name="check" size={14} />
                          </div>
                        )}
                        <p className="truncate text-xs mt-1 muted">{result.title ?? result.result_url}</p>
                      </button>
                    );
                  })}
            </div>
          )}
        </div>
      )}

      <div className="wizard-footer">
        <div className="flex flex-wrap gap-2 items-center">
          {selected.length > 0 ? (
            <>
              <Pill tone="violet">{selected.length} selecionado{selected.length !== 1 ? "s" : ""}</Pill>
              {renderedCount > 0 && <Pill tone="ok">{renderedCount} pronto{renderedCount !== 1 ? "s" : ""}</Pill>}
              {rawCount > 0 && <Pill tone="info">{rawCount} p/ renderizar</Pill>}
            </>
          ) : (
            <span className="text-sm muted">Selecione ao menos 1 vídeo</span>
          )}
        </div>
        <Button
          disabled={selected.length === 0}
          onClick={() => onNext(selected)}
        >
          Próximo
        </Button>
      </div>
    </div>
  );
}
