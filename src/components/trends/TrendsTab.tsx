import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PillListInput, normalizeQuery } from "@/components/automations/WizardInputs";
import {
  persistQuickConfig,
  QuickReactModal,
  SearchResultPreviewModal,
  useQuickReact,
} from "@/components/content/quickReact";
import { useAuth } from "@/auth/AuthContext";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { ContentSearchPlatform, TrendVideo, TrendWatch } from "@/lib/types";

import { isRising, TrendVideoCard, trendToSource } from "./TrendVideoCard";

type Props = {
  avatarId: string;
  onCreateAutomation: (theme: string) => void;
};

type Snapshot = { watches: TrendWatch[]; videos: TrendVideo[] };
const EMPTY: Snapshot = { watches: [], videos: [] };
const ALL_PLATFORMS: ContentSearchPlatform[] = ["youtube", "tiktok", "instagram"];

type PlatformFilter = "all" | ContentSearchPlatform;
type ModeFilter = "all" | "trending" | "rising";

export function TrendsTab({ avatarId, onCreateAutomation }: Props) {
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [preview, setPreview] = useState<TrendVideo | null>(null);
  const [quickFor, setQuickFor] = useState<{ video: TrendVideo | null } | null>(null);

  const {
    reactions,
    savedSourceVideos,
    quickConfig,
    setQuickConfig,
    savingResultIds,
    quickGeneratingIds,
    saveToLibrary,
    createQuickJob,
  } = useQuickReact(avatarId);

  const load = useCallback(async (): Promise<Snapshot> => {
    const [watches, videos] = await Promise.all([
      supabase.from("trend_watches").select("*").eq("avatar_id", avatarId).order("created_at", { ascending: false }),
      supabase.from("trend_videos").select("*").eq("avatar_id", avatarId).order("trend_score", { ascending: false }).limit(200),
    ]);
    if (watches.error) throw watches.error;
    if (videos.error) throw videos.error;
    return {
      watches: (watches.data ?? []) as TrendWatch[],
      videos: (videos.data ?? []) as TrendVideo[],
    };
  }, [avatarId]);

  const { data, loading, refresh } = useSupabaseQuery(load, EMPTY);

  // Auto-refresh on open: fetch fresh trends for the day without the user having
  // to click. trend-scan (non-force) only re-fetches watches older than its 6h
  // TTL, so this is cheap when data is already current. Runs once per avatar.
  const autoRefreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading || autoRefreshedFor.current === avatarId || data.watches.length === 0) return;
    autoRefreshedFor.current = avatarId;
    void autoRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, avatarId, data.watches.length]);

  async function autoRefresh() {
    setRefreshing(true);
    try {
      // No `force`: the function skips watches refreshed within the TTL.
      await invokeFunction("trend-scan", { avatarId });
      await refresh();
    } catch {
      // Silent — the manual "Atualizar" button surfaces errors.
    } finally {
      setRefreshing(false);
    }
  }

  const themes = useMemo(() => data.watches.map((w) => w.theme), [data.watches]);
  const watchById = useMemo(() => new Map(data.watches.map((w) => [w.id, w])), [data.watches]);
  const savedSourceUrls = useMemo(
    () => new Set(savedSourceVideos.map((v) => v.source_url).filter(Boolean)),
    [savedSourceVideos],
  );

  const visibleVideos = useMemo(() => {
    return data.videos.filter((video) => {
      if (platformFilter !== "all" && video.platform !== platformFilter) return false;
      if (modeFilter === "trending" && !video.is_trending) return false;
      if (modeFilter === "rising" && !isRising(video)) return false;
      return true;
    });
  }, [data.videos, platformFilter, modeFilter]);

  // Persisting watch themes: diff the pill list against existing rows.
  async function applyThemes(next: string[]) {
    if (!user) return;
    const current = new Set(themes);
    const incoming = new Set(next);
    const added = next.filter((t) => !current.has(t));
    const removed = data.watches.filter((w) => !incoming.has(w.theme));

    try {
      for (const theme of added) {
        const { error } = await supabase.from("trend_watches").insert({
          user_id: user.id,
          avatar_id: avatarId,
          theme,
          platforms: ALL_PLATFORMS,
        });
        if (error) throw error;
      }
      for (const watch of removed) {
        const { error } = await supabase.from("trend_watches").delete().eq("id", watch.id);
        if (error) throw error;
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar tema");
    }
  }

  async function handleRefresh() {
    if (data.watches.length === 0) {
      toast.error("Adicione ao menos um tema para observar.");
      return;
    }
    setRefreshing(true);
    try {
      const resp = await invokeFunction<{ refreshed: number; videos: TrendVideo[] }>("trend-scan", {
        avatarId,
        force: true,
      });
      toast.success(resp.videos.length > 0 ? `${resp.videos.length} vídeos em alta encontrados` : "Nenhum vídeo encontrado agora");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar trends");
    } finally {
      setRefreshing(false);
    }
  }

  function handleGenerate(video: TrendVideo) {
    const reactionMissing =
      quickConfig && reactions.length > 0 && !reactions.some((r) => r.id === quickConfig.reactionId);
    if (!quickConfig || reactionMissing) {
      setQuickFor({ video });
      return;
    }
    void createQuickJob(trendToSource(video), quickConfig, video.id);
  }

  function handleUseInAutomation(video: TrendVideo) {
    const theme = watchById.get(video.trend_watch_id)?.theme;
    if (theme) onCreateAutomation(theme);
  }

  if (loading) {
    return (
      <div className="mt-4 col" style={{ gap: 8 }}>
        <Skeleton className="h-16 w-full rounded" />
        <Skeleton className="h-64 w-full rounded" />
      </div>
    );
  }

  const noReactions = reactions.length === 0;

  return (
    <div className="mt-4 col" style={{ gap: 14 }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm muted">
          Observe temas e veja o que está em alta no YouTube, TikTok e Instagram.
        </p>
        <div className="flex gap-2">
          <Button
            onClick={() => setQuickFor({ video: null })}
            size="sm"
            title="Configurar reaction rápida"
            variant="outline"
          >
            <Icon name="settings" />
            <span className="hidden sm:inline">
              {quickConfig ? "Reaction rápida" : "Configurar reaction"}
            </span>
          </Button>
          <Button disabled={refreshing} onClick={() => void handleRefresh()} size="sm">
            <Icon name="refresh" size={14} style={{ marginRight: 4 }} />
            {refreshing ? "Atualizando..." : "Atualizar"}
          </Button>
        </div>
      </div>

      <div className="card card-pad" style={{ padding: 12 }}>
        <div className="text-sm mb-2">Temas observados</div>
        <PillListInput
          normalize={normalizeQuery}
          onChange={(next) => void applyThemes(next)}
          placeholder="futebol, gols, pets engraçados..."
          values={themes}
        />
      </div>

      {data.watches.length === 0 ? (
        <div className="empty" style={{ padding: "32px 12px" }}>
          <div>
            <h3>Nenhum tema ainda</h3>
            <p>Adicione um tema acima e clique em Atualizar para ver os vídeos em alta.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(["all", ...ALL_PLATFORMS] as PlatformFilter[]).map((p) => (
              <button
                className={`tab ${platformFilter === p ? "active" : ""}`}
                key={p}
                onClick={() => setPlatformFilter(p)}
                type="button"
              >
                {p === "all" ? "Todas" : platformFilterLabel(p)}
              </button>
            ))}
            <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} />
            {(["all", "trending", "rising"] as ModeFilter[]).map((m) => (
              <button
                className={`tab ${modeFilter === m ? "active" : ""}`}
                key={m}
                onClick={() => setModeFilter(m)}
                type="button"
              >
                {m === "all" ? "Todos" : m === "trending" ? "🔥 Em trend" : "📈 Subindo"}
              </button>
            ))}
          </div>

          {noReactions ? (
            <p className="text-xs muted">
              Sem reaction neste avatar: você pode observar e salvar, mas "Gerar" precisa de uma reaction na Biblioteca.
            </p>
          ) : null}

          {visibleVideos.length === 0 ? (
            <div className="empty" style={{ padding: "32px 12px" }}>
              <div>
                <h3>Nada por aqui ainda</h3>
                <p>Clique em Atualizar para buscar os vídeos em alta dos seus temas.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visibleVideos.map((video) => (
                <TrendVideoCard
                  generating={quickGeneratingIds.includes(video.id)}
                  key={video.id}
                  onGenerate={handleGenerate}
                  onPreview={setPreview}
                  onSave={(v) => void saveToLibrary(trendToSource(v), v.id)}
                  onUseInAutomation={handleUseInAutomation}
                  saved={savedSourceUrls.has(video.source_url)}
                  saving={savingResultIds.includes(video.id)}
                  video={video}
                />
              ))}
            </div>
          )}
        </>
      )}

      {preview ? (
        <SearchResultPreviewModal onClose={() => setPreview(null)} source={trendToSource(preview)} />
      ) : null}

      {quickFor ? (
        <QuickReactModal
          avatarId={avatarId}
          onClose={() => setQuickFor(null)}
          onConfigured={(config) => {
            persistQuickConfig(avatarId, config);
            setQuickConfig(config);
            const pending = quickFor.video;
            setQuickFor(null);
            if (pending) {
              void createQuickJob(trendToSource(pending), config, pending.id);
            } else {
              toast.success("Reaction rápida configurada");
            }
          }}
          reactions={reactions}
          savedConfig={quickConfig}
          source={quickFor.video ? trendToSource(quickFor.video) : null}
        />
      ) : null}
    </div>
  );
}

function platformFilterLabel(platform: ContentSearchPlatform) {
  if (platform === "youtube") return "YouTube";
  if (platform === "tiktok") return "TikTok";
  return "Instagram";
}
