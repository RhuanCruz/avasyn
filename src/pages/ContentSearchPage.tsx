import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AppTopbar,
  AvatarSwitcher,
  Icon,
  Pill,
  formatDate,
  formatNumber,
} from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import {
  formatDuration,
  persistQuickConfig,
  platformLabel,
  platformTone,
  QuickReactModal,
  SearchResultPreviewModal,
  useQuickReact,
} from "@/components/content/quickReact";
import { useAvatarState } from "@/hooks/useAvatarState";
import { invokeFunction } from "@/lib/api";
import type {
  ContentSearchPageTokens,
  ContentSearchPlatform,
  ContentSearchProviderStatus,
  ContentSearchResult,
} from "@/lib/types";

type SearchContentResponse = {
  query: string;
  avatarId: string;
  results: ContentSearchResult[];
  providers: ContentSearchProviderStatus[];
  nextPageTokens?: ContentSearchPageTokens;
};

const DEFAULT_QUERY = "football shorts";
const DEFAULT_RECENT_DAYS = 7;

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
  const [enabledPlatforms, setEnabledPlatforms] = useState<ContentSearchPlatform[]>([
    "youtube",
    "tiktok",
    "instagram",
  ]);
  const [preview, setPreview] = useState<ContentSearchResult | null>(null);
  const [quickModal, setQuickModal] = useState<QuickReactModalState | null>(null);
  const [loadedInitialFeed, setLoadedInitialFeed] = useState(false);

  const {
    reactions,
    savedSourceVideos,
    quickConfig,
    setQuickConfig,
    savingResultIds,
    quickGeneratingIds,
    saveToLibrary,
    createQuickJob,
  } = useQuickReact(selectedAvatarId ?? null);

  useEffect(() => {
    if (!selectedAvatarId) return;
    setLoadedInitialFeed(false);
    setResults([]);
    setProviderStatuses([]);
    setNextPageTokens({});
  }, [selectedAvatarId]);

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
                  A busca inicial mostra vídeos curtos. Use o campo para refinar.
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
                Resultados para "{lastQuery}".
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
                        onSave={(item) => void saveToLibrary(item, item.id)}
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
          <SearchResultPreviewModal onClose={() => setPreview(null)} source={preview} />
        ) : null}

        {quickModal && selectedAvatarId ? (
          <QuickReactModal
            avatarId={selectedAvatarId}
            onClose={() => setQuickModal(null)}
            onConfigured={(config) => {
              persistQuickConfig(selectedAvatarId, config);
              setQuickConfig(config);
              const pending = quickModal.result;
              setQuickModal(null);
              if (pending) {
                void createQuickJob(pending, config, pending.id);
              } else {
                toast.success("Reaction rápida configurada");
              }
            }}
            reactions={reactions}
            savedConfig={quickConfig}
            source={quickModal.result}
          />
        ) : null}
      </div>
    </>
  );

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

    await createQuickJob(result, quickConfig, result.id);
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

function providerStatusLabel(provider: ContentSearchProviderStatus) {
  if (provider.status === "cached") return `${provider.count} em cache`;
  if (provider.status === "ok") return `${provider.count} novos`;
  if (provider.status === "unavailable") return "indisponível";
  return provider.error ?? "erro";
}

function mergeSearchResults(current: ContentSearchResult[], next: ContentSearchResult[]) {
  const byKey = new Map<string, ContentSearchResult>();
  for (const result of [...current, ...next]) {
    byKey.set(`${result.platform}:${result.result_url}`, result);
  }
  return Array.from(byKey.values());
}
