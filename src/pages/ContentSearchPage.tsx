import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import {
  AppTopbar,
  AvatarSwitcher,
  Icon,
  Pill,
  formatDate,
  formatNumber,
} from "@/components/operator-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAvatarState } from "@/hooks/useAvatarState";
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type {
  ContentSearchPageTokens,
  ContentSearchPlatform,
  ContentSearchProviderStatus,
  ContentSearchResult,
  MediaImport,
  ReactionVideo,
  SourceVideo,
} from "@/lib/types";

type SearchContentResponse = {
  query: string;
  avatarId: string;
  results: ContentSearchResult[];
  providers: ContentSearchProviderStatus[];
  nextPageTokens?: ContentSearchPageTokens;
};

type CreateMediaImportResponse = {
  importId: string;
  status: string;
};

type QuickReactJobResponse = {
  job: { id: string };
};

const DEFAULT_QUERY = "football shorts";
const DEFAULT_RECENT_DAYS = 7;
const QUICK_OVERLAY_DEFAULT = "Olha isso";
const QUICK_CAPTION_DEFAULT = "React novo no ar.";
const REACTION_SPLIT_PERCENT = 35;

type QuickReactConfig = {
  caption: string;
  overlayText: string;
  reactionId: string;
};

type QuickReactModalState = {
  result: ContentSearchResult | null;
};

export function ContentSearchPage() {
  const { avatars, selectedAvatar, selectedAvatarId, setSelectedAvatarId } = useAvatarState();
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ContentSearchResult[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<ContentSearchProviderStatus[]>([]);
  const [nextPageTokens, setNextPageTokens] = useState<ContentSearchPageTokens>({});
  const [savingResultIds, setSavingResultIds] = useState<string[]>([]);
  const [enabledPlatforms, setEnabledPlatforms] = useState<ContentSearchPlatform[]>([
    "youtube",
    "tiktok",
  ]);
  const [savedSourceVideos, setSavedSourceVideos] = useState<SourceVideo[]>([]);
  const [reactions, setReactions] = useState<ReactionVideo[]>([]);
  const [preview, setPreview] = useState<ContentSearchResult | null>(null);
  const [quickModal, setQuickModal] = useState<QuickReactModalState | null>(null);
  const [quickConfig, setQuickConfig] = useState<QuickReactConfig | null>(null);
  const [quickGeneratingIds, setQuickGeneratingIds] = useState<string[]>([]);
  const [loadedInitialFeed, setLoadedInitialFeed] = useState(false);

  useEffect(() => {
    if (!selectedAvatarId) return;
    setLoadedInitialFeed(false);
    setResults([]);
    setProviderStatuses([]);
    setNextPageTokens({});
    void loadSavedSources(selectedAvatarId);
    void loadReactions(selectedAvatarId);
  }, [selectedAvatarId]);

  useEffect(() => {
    if (!selectedAvatarId) {
      setQuickConfig(null);
      return;
    }
    setQuickConfig(readQuickConfig(selectedAvatarId));
  }, [selectedAvatarId]);

  useEffect(() => {
    if (!selectedAvatarId || reactions.length === 0 || !quickConfig) return;
    const stillExists = reactions.some((reaction) => reaction.id === quickConfig.reactionId);
    if (!stillExists) setQuickConfig(null);
  }, [quickConfig, reactions, selectedAvatarId]);

  useEffect(() => {
    if (!selectedAvatarId || loadedInitialFeed || searching) return;
    setLoadedInitialFeed(true);
    void searchContent(DEFAULT_QUERY);
  }, [loadedInitialFeed, searching, selectedAvatarId]);

  const savedSourceUrls = useMemo(
    () => new Set(savedSourceVideos.map((video) => video.source_url).filter(Boolean)),
    [savedSourceVideos],
  );

  return (
    <>
      <AppTopbar
        actions={
          <AvatarSwitcher
            avatars={avatars}
            includeAll={false}
            onChange={setSelectedAvatarId}
            selectedAvatarId={selectedAvatarId}
          />
        }
        crumbs={[
          { label: "Workspace", icon: "home", href: "/" },
          { label: "Buscar conteúdos", icon: "search" },
        ]}
      />

      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Buscar conteúdos</h1>
            <p className="page-subtitle">
              Encontre Shorts e referências externas antes de salvar na biblioteca base.
            </p>
          </div>
          {selectedAvatar ? <Pill tone="violet">{selectedAvatar.name}</Pill> : null}
        </div>

        {!selectedAvatarId ? (
          <div className="panel empty">
            <div>
              <h3>Selecione um avatar</h3>
              <p>A busca precisa de um avatar para salvar vídeos na biblioteca correta.</p>
            </div>
          </div>
        ) : (
          <section className="panel card-pad">
            <div className="page-header" style={{ marginBottom: 18 }}>
              <div>
                <h2 className="text-lg">Curadoria de vídeos base</h2>
                <p className="page-subtitle">
                  A busca inicial mostra vídeos curtos do YouTube. Use o campo para refinar.
                </p>
              </div>
              <Pill tone="base">{results.length} resultados</Pill>
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <input
                className="input"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void searchContent();
                }}
                placeholder="Neymar edits, gol bicicleta, futebol engraçado..."
                value={query}
              />
              <div className="flex gap-2">
                <Button
                  disabled={!selectedAvatarId}
                  onClick={() => setQuickModal({ result: null })}
                  title="Configurar reaction rápida"
                  variant="outline"
                >
                  <Icon name="settings" />
                  <span className="hidden sm:inline">
                    {quickConfig ? "Reaction rápida" : "Configurar reaction"}
                  </span>
                </Button>
                <Button disabled={searching} onClick={() => void searchContent()}>
                  {searching ? "Buscando..." : "Buscar"}
                </Button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(["youtube", "tiktok", "instagram"] as ContentSearchPlatform[]).map((platform) => (
                <button
                  className={`tab ${enabledPlatforms.includes(platform) ? "active" : ""}`}
                  key={platform}
                  onClick={() => togglePlatform(platform)}
                  type="button"
                >
                  {platformLabel(platform)}
                </button>
              ))}
            </div>

            {providerStatuses.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {providerStatuses.map((provider) => (
                  <Pill
                    key={provider.platform}
                    tone={provider.status === "error" || provider.status === "unavailable" ? "err" : "neutral"}
                  >
                    {platformLabel(provider.platform)}: {providerStatusLabel(provider)}
                  </Pill>
                ))}
              </div>
            ) : null}

            {lastQuery ? (
              <p className="mt-4 text-xs muted">
                Resultados para "{lastQuery}". YouTube usa vídeos curtos e filtro local para aproximar Shorts.
              </p>
            ) : null}

            {results.length > 0 ? (
              <>
                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {results.map((result) => {
                    const saved = savedSourceUrls.has(result.result_url);
                    const saving = savingResultIds.includes(result.id);

                    return (
                      <ContentResultCard
                        generating={quickGeneratingIds.includes(result.id)}
                        key={result.id}
                        onPreview={setPreview}
                        onQuickGenerate={(item) => void handleQuickGenerate(item)}
                        onSave={(item) => void saveSearchResult(item)}
                        result={result}
                        saved={saved}
                        saving={saving}
                      />
                    );
                  })}
                </div>
                <div className="mt-5 flex justify-center">
                  <Button
                    disabled={!canLoadMore() || searching}
                    onClick={() => void loadMoreContent()}
                    variant="outline"
                  >
                    {searching ? "Carregando..." : canLoadMore() ? "Carregar mais" : "Sem mais resultados"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="empty mt-5" style={{ padding: "44px 12px" }}>
                <div>
                  <h3>Nenhum resultado ainda</h3>
                  <p>Digite uma busca ou aguarde os vídeos iniciais carregarem.</p>
                </div>
              </div>
            )}
          </section>
        )}

        {preview ? (
          <SearchResultPreviewModal
            onClose={() => setPreview(null)}
            result={preview}
          />
        ) : null}

        {quickModal && selectedAvatarId ? (
          <QuickReactModal
            avatarId={selectedAvatarId}
            onClose={() => setQuickModal(null)}
            onConfigured={(config) => {
              persistQuickConfig(selectedAvatarId, config);
              setQuickConfig(config);
              setQuickModal(null);
              if (quickModal.result) {
                void createQuickJobFromResult(quickModal.result, config);
              } else {
                toast.success("Reaction rápida configurada");
              }
            }}
            reactions={reactions}
            result={quickModal.result}
            savedConfig={quickConfig}
          />
        ) : null}
      </div>
    </>
  );

  async function loadSavedSources(avatarId: string) {
    const { data, error } = await supabase
      .from("source_videos")
      .select("*")
      .eq("avatar_id", avatarId);

    if (error) {
      toast.error(error.message);
      return;
    }

    setSavedSourceVideos((data ?? []) as SourceVideo[]);
  }

  async function loadReactions(avatarId: string) {
    const { data, error } = await supabase
      .from("reaction_videos")
      .select("*")
      .eq("avatar_id", avatarId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(error.message);
      return;
    }

    setReactions((data ?? []) as ReactionVideo[]);
  }

  function togglePlatform(platform: ContentSearchPlatform) {
    setEnabledPlatforms((current) => {
      const next = current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform];
      return next.length > 0 ? next : current;
    });
  }

  async function searchContent(overrideQuery?: string) {
    if (!selectedAvatarId) {
      toast.error("Selecione um avatar");
      return;
    }

    const searchQuery = (overrideQuery ?? query).trim();
    if (searchQuery.length < 2) {
      toast.error("Digite uma busca com pelo menos 2 caracteres");
      return;
    }

    setSearching(true);
    try {
      const response = await invokeFunction<SearchContentResponse>("search-content", {
        avatarId: selectedAvatarId,
        query: searchQuery,
        platforms: enabledPlatforms,
        limitPerPlatform: 12,
        order: "viewCount",
        recentDays: DEFAULT_RECENT_DAYS,
      });
      setResults(response.results);
      setProviderStatuses(response.providers);
      setNextPageTokens(response.nextPageTokens ?? {});
      setLastQuery(searchQuery);
      if (!overrideQuery) setQuery(searchQuery);
      if (response.results.length === 0) toast.info("Nenhum resultado encontrado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao buscar conteúdo");
    } finally {
      setSearching(false);
    }
  }

  async function loadMoreContent() {
    if (!selectedAvatarId) return;

    const platformsWithToken = enabledPlatforms.filter((platform) => nextPageTokens[platform]);
    if (platformsWithToken.length === 0) return;

    setSearching(true);
    try {
      const response = await invokeFunction<SearchContentResponse>("search-content", {
        avatarId: selectedAvatarId,
        query: lastQuery || query,
        platforms: platformsWithToken,
        limitPerPlatform: 12,
        order: "viewCount",
        recentDays: DEFAULT_RECENT_DAYS,
        pageTokens: nextPageTokens,
      });

      setResults((current) => mergeSearchResults(current, response.results));
      setProviderStatuses(response.providers);
      setNextPageTokens(response.nextPageTokens ?? {});
      if (response.results.length === 0) toast.info("Nenhum resultado adicional encontrado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar mais resultados");
    } finally {
      setSearching(false);
    }
  }

  async function saveSearchResult(result: ContentSearchResult) {
    if (!selectedAvatarId) return;

    setSavingResultIds((current) => [...current, result.id]);
    try {
      await ensureSourceVideo(result);
      toast.success("Vídeo salvo na biblioteca");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar na biblioteca");
    } finally {
      setSavingResultIds((current) => current.filter((id) => id !== result.id));
    }
  }

  async function handleQuickGenerate(result: ContentSearchResult) {
    if (!selectedAvatarId) {
      toast.error("Selecione um avatar");
      return;
    }

    const configuredReactionIsMissing =
      quickConfig && reactions.length > 0 && !reactions.some((reaction) => reaction.id === quickConfig.reactionId);

    if (!quickConfig || configuredReactionIsMissing) {
      setQuickModal({ result });
      return;
    }

    await createQuickJobFromResult(result, quickConfig);
  }

  async function createQuickJobFromResult(result: ContentSearchResult, config: QuickReactConfig) {
    if (!selectedAvatarId) return;
    if (quickGeneratingIds.includes(result.id)) return;

    setQuickGeneratingIds((current) => [...current, result.id]);
    try {
      toast.info("Enviando react para renderização...");
      const sourceVideo = await ensureSourceVideo(result);
      const response = await invokeFunction<QuickReactJobResponse>("create-quick-react-job", {
        avatarId: selectedAvatarId,
        sourceVideoId: sourceVideo.id,
        reactionId: config.reactionId,
        overlayText: config.overlayText,
        caption: config.caption,
      });
      toast.success("Job de react enviado para renderização");
      console.info("Quick react job created", response.job.id);
    } catch (error) {
      toast.error(formatMediaImportError(error instanceof Error ? error.message : null));
    } finally {
      setQuickGeneratingIds((current) => current.filter((id) => id !== result.id));
    }
  }

  async function ensureSourceVideo(result: ContentSearchResult) {
    if (!selectedAvatarId) throw new Error("Selecione um avatar");

    const cached = savedSourceVideos.find((video) => video.source_url === result.result_url);
    if (cached) return cached;

    const existing = await findSourceVideoForResult(selectedAvatarId, result);
    if (existing) {
      setSavedSourceVideos((current) => mergeSourceVideos(current, [existing]));
      return existing;
    }

    const response = await invokeFunction<CreateMediaImportResponse>("create-media-import", {
      avatarId: selectedAvatarId,
      type: "url",
      input: result.result_url,
      limit: 1,
    });
    toast.info("Baixando vídeo para a biblioteca...");
    await waitForImportCompletion(response.importId);

    let imported: SourceVideo | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      imported = await findSourceVideoForResult(selectedAvatarId, result);
      if (imported) break;
      await sleep(1000);
    }

    if (!imported) {
      throw new Error("Importação concluída, mas o vídeo não apareceu na biblioteca");
    }

    setSavedSourceVideos((current) => mergeSourceVideos(current, [imported]));
    return imported;
  }

  async function findSourceVideoForResult(avatarId: string, result: ContentSearchResult) {
    const { data, error } = await supabase
      .from("source_videos")
      .select("*")
      .eq("avatar_id", avatarId)
      .eq("source_url", result.result_url)
      .maybeSingle();

    if (error) throw error;
    return data ? data as SourceVideo : null;
  }

  async function waitForImportCompletion(importId: string) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const { data, error } = await supabase
        .from("media_imports")
        .select("*")
        .eq("id", importId)
        .single();

      if (error) throw error;
      const mediaImport = data as MediaImport;
      if (mediaImport.status === "completed" || mediaImport.status === "partial") return;
      if (mediaImport.status === "error") {
        throw new Error(formatMediaImportError(mediaImport.error_message));
      }
      await sleep(2000);
    }

    toast.info("Importação ainda em andamento. A biblioteca será atualizada quando terminar.");
  }

  function canLoadMore() {
    return enabledPlatforms.some((platform) => Boolean(nextPageTokens[platform]));
  }
}

function ContentResultCard({
  generating,
  onQuickGenerate,
  onPreview,
  onSave,
  result,
  saved,
  saving,
}: {
  generating: boolean;
  onQuickGenerate: (result: ContentSearchResult) => void;
  onPreview: (result: ContentSearchResult) => void;
  onSave: (result: ContentSearchResult) => void;
  result: ContentSearchResult;
  saved: boolean;
  saving: boolean;
}) {
  return (
    <article className="card card-pad">
      <button
        className="overflow-hidden bg-muted"
        onClick={() => onPreview(result)}
        style={{
          aspectRatio: "9 / 16",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "block",
          padding: 0,
          width: "100%",
        }}
        type="button"
      >
        {result.thumbnail_url ? (
          <img
            alt={result.title ?? "Resultado de busca"}
            className="h-full w-full object-cover"
            loading="lazy"
            src={result.thumbnail_url}
          />
        ) : (
          <div className="empty h-full">
            <div>
              <h3>Sem thumbnail</h3>
              <p>{platformLabel(result.platform)}</p>
            </div>
          </div>
        )}
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Pill tone={platformTone(result.platform)}>{platformLabel(result.platform)}</Pill>
        {result.duration_s ? <Pill tone="neutral">{formatDuration(result.duration_s)}</Pill> : null}
      </div>

      <div className="mt-3 col" style={{ gap: 6 }}>
        <span className="line-clamp-2 text-sm">{result.title ?? "Sem título"}</span>
        {result.author_username ? <span className="text-xs muted">{result.author_username}</span> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs muted">
        {result.view_count ? <span>{formatNumber(result.view_count)} views</span> : null}
        {result.like_count ? <span>{formatNumber(result.like_count)} likes</span> : null}
        {result.published_at ? <span>{formatDate(result.published_at)}</span> : null}
      </div>

      <div className="mt-4 flex gap-2">
        <Button className="flex-1" onClick={() => onPreview(result)} size="sm" variant="outline">
          Ver
        </Button>
        <Button
          className="flex-1"
          disabled={generating}
          onClick={() => onQuickGenerate(result)}
          size="sm"
          variant="outline"
        >
          {generating ? "Enviando..." : "Gerar"}
        </Button>
        <Button
          className="flex-1"
          disabled={saved || saving}
          onClick={() => onSave(result)}
          size="sm"
        >
          {saved ? "Na biblioteca" : saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </article>
  );
}

function QuickReactModal({
  avatarId,
  onClose,
  onConfigured,
  reactions,
  result,
  savedConfig,
}: {
  avatarId: string;
  onClose: () => void;
  onConfigured: (config: QuickReactConfig) => void;
  reactions: ReactionVideo[];
  result: ContentSearchResult | null;
  savedConfig: QuickReactConfig | null;
}) {
  const initialReaction =
    reactions.find((reaction) => reaction.id === savedConfig?.reactionId) ?? reactions[0] ?? null;
  const [reactionId, setReactionId] = useState(initialReaction?.id ?? "");
  const selectedReaction = reactions.find((reaction) => reaction.id === reactionId) ?? null;
  const [positionX, setPositionX] = useState(selectedReaction?.position_x ?? 0);
  const [positionY, setPositionY] = useState(selectedReaction?.position_y ?? 0);
  const [overlayText, setOverlayText] = useState(savedConfig?.overlayText ?? QUICK_OVERLAY_DEFAULT);
  const [caption, setCaption] = useState(savedConfig?.caption ?? QUICK_CAPTION_DEFAULT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedReaction) return;
    setPositionX(selectedReaction.position_x ?? 0);
    setPositionY(selectedReaction.position_y ?? 0);
  }, [selectedReaction?.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="panel"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "100%", maxWidth: 1080, padding: 20 }}
      >
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div>
            <h2 className="text-lg">Configurar reaction rápida</h2>
            <p className="page-subtitle">
              {result
                ? "Salve a reaction padrão para gerar este vídeo e os próximos com um clique."
                : "Escolha a reaction padrão usada pelo botão Gerar nos cards de busca."}
            </p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>

        {reactions.length === 0 ? (
          <div className="empty" style={{ minHeight: 320 }}>
            <div>
              <h3>Nenhuma reaction configurada</h3>
              <p>Envie uma reaction na biblioteca antes de usar a geração rápida.</p>
              <Link
                className={buttonVariants({ variant: "outline", className: "mt-4" })}
                to={`/library?avatarId=${avatarId}&kind=reaction`}
              >
                Abrir biblioteca
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
            <div className="col" style={{ gap: 14 }}>
              <QuickReactionSplitPreview
                caption={caption}
                overlayText={overlayText}
                positionX={positionX}
                positionY={positionY}
                reaction={selectedReaction}
                result={result}
              />
              <p className="text-xs muted">
                A prévia usa o mesmo recorte da renderização: reaction em cima e vídeo base embaixo.
              </p>
            </div>

            <div className="col" style={{ gap: 14 }}>
              {result ? (
                <div>
                  <div className="text-sm muted mb-1">Vídeo base</div>
                  <div className="text-sm">{result.title ?? result.result_url}</div>
                </div>
              ) : null}

              <label className="col text-sm" style={{ gap: 8 }}>
                Reaction
                <select
                  className="input"
                  onChange={(event) => setReactionId(event.target.value)}
                  value={reactionId}
                >
                  {reactions.map((reaction) => (
                    <option key={reaction.id} value={reaction.id}>{reaction.name}</option>
                  ))}
                </select>
              </label>

              <label className="col text-sm" style={{ gap: 8 }}>
                Horizontal
                <input
                  max={100}
                  min={-100}
                  onChange={(event) => setPositionX(Number(event.target.value))}
                  type="range"
                  value={positionX}
                />
                <span className="text-xs muted">{positionX}</span>
              </label>

              <label className="col text-sm" style={{ gap: 8 }}>
                Vertical
                <input
                  max={100}
                  min={-100}
                  onChange={(event) => setPositionY(Number(event.target.value))}
                  type="range"
                  value={positionY}
                />
                <span className="text-xs muted">{positionY}</span>
              </label>

              <label className="col text-sm" style={{ gap: 8 }}>
                Texto da divisão
                <input
                  className="input"
                  maxLength={32}
                  onChange={(event) => setOverlayText(event.target.value)}
                  value={overlayText}
                />
              </label>

              <label className="col text-sm" style={{ gap: 8 }}>
                Legenda
                <textarea
                  className="input"
                  onChange={(event) => setCaption(event.target.value)}
                  rows={4}
                  value={caption}
                />
              </label>

              <div className="flex gap-2">
                <Button disabled={saving || !reactionId} onClick={() => void saveQuickConfig()}>
                  {saving ? "Salvando..." : result ? "Salvar e gerar" : "Salvar configuração"}
                </Button>
                <Button onClick={onClose} variant="outline">Cancelar</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  async function saveQuickConfig() {
    if (!reactionId) return;
    setSaving(true);
    try {
      const { error: positionError } = await supabase
        .from("reaction_videos")
        .update({ position_x: positionX, position_y: positionY })
        .eq("id", reactionId)
        .eq("avatar_id", avatarId);
      if (positionError) throw positionError;

      onConfigured({
        caption: caption.trim() || QUICK_CAPTION_DEFAULT,
        overlayText: normalizeQuickOverlayText(overlayText),
        reactionId,
      });
    } catch (error) {
      toast.error(formatMediaImportError(error instanceof Error ? error.message : null));
    } finally {
      setSaving(false);
    }
  }
}

function QuickReactionSplitPreview({
  caption,
  overlayText,
  positionX,
  positionY,
  reaction,
  result,
}: {
  caption: string;
  overlayText: string;
  positionX: number;
  positionY: number;
  reaction: ReactionVideo | null;
  result: ContentSearchResult | null;
}) {
  const [reactionUrl, setReactionUrl] = useState<string | null>(null);
  const reactionObjectPosition = `${positionToObjectPercent(positionX)}% ${positionToObjectPercent(positionY)}%`;

  useEffect(() => {
    let cancelled = false;
    setReactionUrl(null);
    if (!reaction) return;

    supabase.storage
      .from("reaction-videos")
      .createSignedUrl(reaction.storage_path, 60 * 30)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error(error.message);
          return;
        }
        setReactionUrl(data.signedUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [reaction?.storage_path]);

  return (
    <div
      className="overflow-hidden bg-black"
      style={{
        aspectRatio: "9 / 16",
        border: "1px solid var(--border)",
        borderRadius: 10,
        position: "relative",
      }}
    >
      <div
        style={{
          height: `${REACTION_SPLIT_PERCENT}%`,
          overflow: "hidden",
          position: "relative",
          width: "100%",
        }}
      >
        {reactionUrl ? (
          <video
            autoPlay
            loop
            muted
            playsInline
            src={reactionUrl}
            style={{
              height: "100%",
              objectFit: "cover",
              objectPosition: reactionObjectPosition,
              width: "100%",
            }}
          />
        ) : (
          <div className="empty h-full">
            <div>
              <h3>Reaction</h3>
              <p>{reaction ? "Carregando..." : "Selecione uma reaction"}</p>
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          height: `${100 - REACTION_SPLIT_PERCENT}%`,
          overflow: "hidden",
          position: "relative",
          width: "100%",
        }}
      >
        {result?.thumbnail_url ? (
          <img
            alt={result.title ?? "Vídeo base"}
            src={result.thumbnail_url}
            style={{ height: "100%", objectFit: "cover", width: "100%" }}
          />
        ) : (
          <div className="empty h-full">
            <div>
              <h3>Vídeo base</h3>
              <p>{result ? "Thumbnail indisponível" : "Prévia do conteúdo selecionado"}</p>
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          background: "rgba(0,0,0,.68)",
          borderRadius: 8,
          color: "white",
          fontSize: 12,
          fontWeight: 600,
          left: "50%",
          maxWidth: "82%",
          padding: "5px 9px",
          position: "absolute",
          textAlign: "center",
          top: `calc(${REACTION_SPLIT_PERCENT}% - 14px)`,
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
        }}
      >
        {normalizeQuickOverlayText(overlayText)}
      </div>

      {caption.trim() ? (
        <div
          className="text-xs"
          style={{
            background: "linear-gradient(180deg, transparent, rgba(0,0,0,.68))",
            bottom: 0,
            color: "white",
            left: 0,
            padding: "28px 12px 10px",
            position: "absolute",
            right: 0,
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}

function SearchResultPreviewModal({
  onClose,
  result,
}: {
  onClose: () => void;
  result: ContentSearchResult;
}) {
  const youtubeId = result.platform === "youtube"
    ? result.external_id ?? extractYouTubeId(result.result_url)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="panel"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "100%", maxWidth: 980, padding: 20 }}
      >
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div>
            <div className="flex items-center gap-2">
              <Pill tone={platformTone(result.platform)}>{platformLabel(result.platform)}</Pill>
              <span className="text-lg">{result.title ?? "Preview"}</span>
            </div>
            <p className="page-subtitle">
              {result.author_username ? `${result.author_username} · ` : ""}
              {result.duration_s ? formatDuration(result.duration_s) : "Resultado externo"}
            </p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>

        {youtubeId ? (
          <div
            className="overflow-hidden bg-black"
            style={{
              aspectRatio: "9 / 16",
              border: "1px solid var(--border)",
              borderRadius: 10,
              margin: "0 auto",
              maxHeight: "72vh",
              maxWidth: 420,
            }}
          >
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&playsinline=1`}
              style={{ border: 0, height: "100%", width: "100%" }}
              title={result.title ?? "YouTube preview"}
            />
          </div>
        ) : (
          <div className="empty" style={{ minHeight: 420 }}>
            <div>
              <h3>Preview indisponível</h3>
              <p>Esta plataforma ainda não tem player incorporado no Avasyn.</p>
              <a
                className={buttonVariants({ variant: "outline", className: "mt-4" })}
                href={result.result_url}
                rel="noreferrer"
                target="_blank"
              >
                Abrir origem
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function platformLabel(platform: ContentSearchPlatform) {
  if (platform === "youtube") return "YouTube";
  if (platform === "tiktok") return "TikTok";
  return "Instagram";
}

function platformTone(platform: ContentSearchPlatform) {
  if (platform === "youtube") return "info";
  if (platform === "tiktok") return "violet";
  return "reaction";
}

function providerStatusLabel(provider: ContentSearchProviderStatus) {
  if (provider.status === "cached") return `${provider.count} em cache`;
  if (provider.status === "ok") return `${provider.count} novos`;
  if (provider.status === "unavailable") return "indisponível";
  return provider.error ?? "erro";
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, Math.trunc(totalSeconds % 60));
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function mergeSearchResults(
  current: ContentSearchResult[],
  next: ContentSearchResult[],
) {
  const byKey = new Map<string, ContentSearchResult>();
  for (const result of [...current, ...next]) {
    byKey.set(`${result.platform}:${result.result_url}`, result);
  }
  return Array.from(byKey.values());
}

function mergeSourceVideos(current: SourceVideo[], next: SourceVideo[]) {
  const byId = new Map<string, SourceVideo>();
  for (const video of [...current, ...next]) {
    byId.set(video.id, video);
  }
  return Array.from(byId.values());
}

function readQuickConfig(avatarId: string): QuickReactConfig | null {
  try {
    const raw = localStorage.getItem(quickConfigStorageKey(avatarId));
    if (!raw) {
      const legacyReactionId = localStorage.getItem(`avasyn:quick-reaction:${avatarId}`);
      return legacyReactionId
        ? {
          caption: QUICK_CAPTION_DEFAULT,
          overlayText: QUICK_OVERLAY_DEFAULT,
          reactionId: legacyReactionId,
        }
        : null;
    }

    const parsed = JSON.parse(raw) as Partial<QuickReactConfig>;
    if (!parsed.reactionId) return null;
    return {
      caption: String(parsed.caption ?? QUICK_CAPTION_DEFAULT),
      overlayText: normalizeQuickOverlayText(parsed.overlayText ?? QUICK_OVERLAY_DEFAULT),
      reactionId: String(parsed.reactionId),
    };
  } catch {
    return null;
  }
}

function persistQuickConfig(avatarId: string, config: QuickReactConfig) {
  localStorage.setItem(quickConfigStorageKey(avatarId), JSON.stringify({
    caption: config.caption.trim() || QUICK_CAPTION_DEFAULT,
    overlayText: normalizeQuickOverlayText(config.overlayText),
    reactionId: config.reactionId,
  }));
}

function quickConfigStorageKey(avatarId: string) {
  return `avasyn:quick-react-config:${avatarId}`;
}

function normalizeQuickOverlayText(value: string) {
  const words = String(value || QUICK_OVERLAY_DEFAULT)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  return words.length > 0 ? words.join(" ") : QUICK_OVERLAY_DEFAULT;
}

function positionToObjectPercent(value: number) {
  const numeric = Number(value);
  const clamped = Math.max(-100, Math.min(100, Number.isFinite(numeric) ? numeric : 0));
  return (clamped + 100) / 2;
}

function extractYouTubeId(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.replace("/", "") || null;
    }
    if (parsed.pathname.startsWith("/shorts/")) {
      return parsed.pathname.split("/")[2] ?? null;
    }
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatMediaImportError(message: string | null) {
  if (!message) return "Falha ao importar mídia";

  if (/Apify YouTube downloader returned demo output|actor subscription|APIFY_YOUTUBE_DOWNLOADER_ACTOR_ID|downloadable YouTube video URL/i.test(message)) {
    return "A Apify não retornou um MP4 baixável. Verifique se o actor do YouTube está liberado/subscrito na sua conta Apify.";
  }

  if (/SAVENOW_API_KEY|SaveNow/i.test(message)) {
    return "A API SaveNow não retornou um vídeo baixável. Verifique a chave/formato do worker e tente novamente.";
  }

  if (/Sign in to confirm you.?re not a bot|cookies-from-browser|--cookies/i.test(message)) {
    return "YouTube bloqueou o download. Atualize YOUTUBE_COOKIES_BASE64 no worker e rode novamente.";
  }

  if (/Unsupported url|Unable to handle request/i.test(message)) {
    return "Não foi possível baixar este link. Tente outro vídeo ou verifique o worker.";
  }

  return message;
}
