// Shared "quick react" engine + UI, used by both the Buscar Conteúdos page and
// the Trends tab. Centralizes the proven flow: ensure the external video is in
// the library (create-media-import) → fire create-quick-react-job, plus the
// reaction-config modal and the result preview modal.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Icon, Pill } from "@/components/operator-ui";
import { useRenderQueue } from "@/components/render-queue/RenderQueueContext";
import { Button, buttonVariants } from "@/components/ui/button";
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { getStorageSignedUrl } from "@/lib/storage-client";
import type {
  ContentSearchPlatform,
  MediaImport,
  ReactionVideo,
  SourceVideo,
} from "@/lib/types";

export const QUICK_OVERLAY_DEFAULT = "Olha isso";
export const QUICK_CAPTION_DEFAULT = "React novo no ar.";
const REACTION_SPLIT_PERCENT = 35;

// Minimal shape both ContentSearchResult and TrendVideo satisfy.
export type QuickReactSource = {
  result_url: string;
  title: string | null;
  thumbnail_url: string | null;
  platform: ContentSearchPlatform;
  external_id: string | null;
  duration_s?: number | null;
  author_username?: string | null;
  view_count?: number | null;
  like_count?: number | null;
  published_at?: string | null;
};

export type QuickReactConfig = {
  caption: string;
  overlayText: string;
  reactionId: string;
};

type CreateMediaImportResponse = { importId: string; status: string };
type QuickReactJobResponse = { job: { id: string } };

export function useQuickReact(avatarId: string | null) {
  const [savedSourceVideos, setSavedSourceVideos] = useState<SourceVideo[]>([]);
  const [reactions, setReactions] = useState<ReactionVideo[]>([]);
  const [quickConfig, setQuickConfig] = useState<QuickReactConfig | null>(null);
  const [savingResultIds, setSavingResultIds] = useState<string[]>([]);
  const [quickGeneratingIds, setQuickGeneratingIds] = useState<string[]>([]);
  const renderQueue = useRenderQueue();

  const reload = useCallback(async () => {
    if (!avatarId) {
      setSavedSourceVideos([]);
      setReactions([]);
      return;
    }
    const [sources, reactionRows] = await Promise.all([
      supabase.from("source_videos").select("*").eq("avatar_id", avatarId),
      supabase.from("reaction_videos").select("*").eq("avatar_id", avatarId).order("created_at", { ascending: false }),
    ]);
    if (sources.error) toast.error(sources.error.message);
    else setSavedSourceVideos((sources.data ?? []) as SourceVideo[]);
    if (reactionRows.error) toast.error(reactionRows.error.message);
    else setReactions((reactionRows.data ?? []) as ReactionVideo[]);
  }, [avatarId]);

  useEffect(() => {
    void reload();
    setQuickConfig(avatarId ? readQuickConfig(avatarId) : null);
  }, [avatarId, reload]);

  // Drop a stale config if its reaction was deleted.
  useEffect(() => {
    if (!avatarId || reactions.length === 0 || !quickConfig) return;
    if (!reactions.some((reaction) => reaction.id === quickConfig.reactionId)) setQuickConfig(null);
  }, [avatarId, quickConfig, reactions]);

  const ensureSourceVideo = useCallback(async (source: QuickReactSource) => {
    if (!avatarId) throw new Error("Selecione um avatar");

    const cached = savedSourceVideos.find((video) => sourceMatchesVideo(video, source));
    if (cached) return cached;

    const existing = await findSourceVideoForSource(avatarId, source);
    if (existing) {
      setSavedSourceVideos((current) => mergeSourceVideos(current, [existing]));
      return existing;
    }

    const response = await invokeFunction<CreateMediaImportResponse>("create-media-import", {
      avatarId,
      type: "url",
      input: source.result_url,
      limit: 1,
    });
    toast.info("Baixando vídeo para a biblioteca...");
    await waitForImportCompletion(response.importId);

    let imported: SourceVideo | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      imported = await findSourceVideoForSource(avatarId, source);
      if (imported) break;
      await sleep(1000);
    }
    if (!imported) throw new Error("Importação concluída, mas o vídeo não apareceu na biblioteca");

    setSavedSourceVideos((current) => mergeSourceVideos(current, [imported!]));
    return imported;
  }, [avatarId, savedSourceVideos]);

  const saveToLibrary = useCallback(async (source: QuickReactSource, trackId: string) => {
    if (!avatarId) return;
    setSavingResultIds((current) => [...current, trackId]);
    try {
      await ensureSourceVideo(source);
      toast.success("Vídeo salvo na biblioteca");
    } catch (error) {
      toast.error(formatMediaImportError(error instanceof Error ? error.message : null));
    } finally {
      setSavingResultIds((current) => current.filter((id) => id !== trackId));
    }
  }, [avatarId, ensureSourceVideo]);

  const createQuickJob = useCallback(async (
    source: QuickReactSource,
    config: QuickReactConfig,
    trackId: string,
  ) => {
    if (!avatarId || quickGeneratingIds.includes(trackId)) return;
    setQuickGeneratingIds((current) => [...current, trackId]);
    const render = renderQueue.startItem({
      title: source.title ?? source.result_url,
      thumbnailUrl: source.thumbnail_url,
    });
    try {
      render.setDownloading();
      const sourceVideo = await ensureSourceVideo(source);
      const response = await invokeFunction<QuickReactJobResponse>("create-quick-react-job", {
        avatarId,
        sourceVideoId: sourceVideo.id,
        reactionId: config.reactionId,
        overlayText: config.overlayText,
        caption: config.caption,
      });
      render.attachJob(response.job.id);
      console.info("Quick react job created", response.job.id);
    } catch (error) {
      const message = formatMediaImportError(error instanceof Error ? error.message : null);
      render.fail(message);
      toast.error(message);
    } finally {
      setQuickGeneratingIds((current) => current.filter((id) => id !== trackId));
    }
  }, [avatarId, ensureSourceVideo, quickGeneratingIds, renderQueue]);

  return {
    reactions,
    savedSourceVideos,
    quickConfig,
    setQuickConfig,
    savingResultIds,
    quickGeneratingIds,
    reload,
    ensureSourceVideo,
    saveToLibrary,
    createQuickJob,
  };
}

export function QuickReactModal({
  avatarId,
  onClose,
  onConfigured,
  reactions,
  source,
  savedConfig,
}: {
  avatarId: string;
  onClose: () => void;
  onConfigured: (config: QuickReactConfig) => void;
  reactions: ReactionVideo[];
  source: QuickReactSource | null;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="panel"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "100%", maxWidth: 1080, padding: 20 }}
      >
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div>
            <h2 className="text-lg">Configurar reaction rápida</h2>
            <p className="page-subtitle">
              {source
                ? "Salve a reaction padrão para gerar este vídeo e os próximos com um clique."
                : "Escolha a reaction padrão usada pelo botão Gerar nos cards."}
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
                source={source}
              />
              <p className="text-xs muted">
                A prévia usa o mesmo recorte da renderização: reaction em cima e vídeo base embaixo.
              </p>
            </div>

            <div className="col" style={{ gap: 14 }}>
              {source ? (
                <div>
                  <div className="text-sm muted mb-1">Vídeo base</div>
                  <div className="text-sm">{source.title ?? source.result_url}</div>
                </div>
              ) : null}

              <label className="col text-sm" style={{ gap: 8 }}>
                Reaction
                <select className="input" onChange={(event) => setReactionId(event.target.value)} value={reactionId}>
                  {reactions.map((reaction) => (
                    <option key={reaction.id} value={reaction.id}>{reaction.name}</option>
                  ))}
                </select>
              </label>

              <label className="col text-sm" style={{ gap: 8 }}>
                Horizontal
                <input max={100} min={-100} onChange={(event) => setPositionX(Number(event.target.value))} type="range" value={positionX} />
                <span className="text-xs muted">{positionX}</span>
              </label>

              <label className="col text-sm" style={{ gap: 8 }}>
                Vertical
                <input max={100} min={-100} onChange={(event) => setPositionY(Number(event.target.value))} type="range" value={positionY} />
                <span className="text-xs muted">{positionY}</span>
              </label>

              <label className="col text-sm" style={{ gap: 8 }}>
                Texto da divisão
                <input className="input" maxLength={32} onChange={(event) => setOverlayText(event.target.value)} value={overlayText} />
              </label>

              <label className="col text-sm" style={{ gap: 8 }}>
                Legenda
                <textarea className="input" onChange={(event) => setCaption(event.target.value)} rows={4} value={caption} />
              </label>

              <div className="flex gap-2">
                <Button disabled={saving || !reactionId} onClick={() => void saveQuickConfig()}>
                  {saving ? "Salvando..." : source ? "Salvar e gerar" : "Salvar configuração"}
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
  source,
}: {
  caption: string;
  overlayText: string;
  positionX: number;
  positionY: number;
  reaction: ReactionVideo | null;
  source: QuickReactSource | null;
}) {
  const [reactionUrl, setReactionUrl] = useState<string | null>(null);
  const reactionObjectPosition = `${positionToObjectPercent(positionX)}% ${positionToObjectPercent(positionY)}%`;

  useEffect(() => {
    let cancelled = false;
    setReactionUrl(null);
    if (!reaction) return;
    getStorageSignedUrl("reaction-videos", reaction.storage_path)
      .then((url) => { if (!cancelled) setReactionUrl(url); })
      .catch((err) => { if (!cancelled) toast.error(err instanceof Error ? err.message : "Falha ao carregar vídeo"); });
    return () => { cancelled = true; };
  }, [reaction?.storage_path]);

  return (
    <div
      className="overflow-hidden bg-black"
      style={{ aspectRatio: "9 / 16", border: "1px solid var(--border)", borderRadius: 10, position: "relative" }}
    >
      <div style={{ height: `${REACTION_SPLIT_PERCENT}%`, overflow: "hidden", position: "relative", width: "100%" }}>
        {reactionUrl ? (
          <video autoPlay loop muted playsInline src={reactionUrl}
            style={{ height: "100%", objectFit: "cover", objectPosition: reactionObjectPosition, width: "100%" }} />
        ) : (
          <div className="empty h-full">
            <div>
              <h3>Reaction</h3>
              <p>{reaction ? "Carregando..." : "Selecione uma reaction"}</p>
            </div>
          </div>
        )}
      </div>

      <div style={{ height: `${100 - REACTION_SPLIT_PERCENT}%`, overflow: "hidden", position: "relative", width: "100%" }}>
        {source?.thumbnail_url ? (
          <img alt="" referrerPolicy="no-referrer" src={source.thumbnail_url}
            style={{ height: "100%", objectFit: "cover", width: "100%" }} />
        ) : (
          <div className="empty h-full">
            <div>
              <h3>Vídeo base</h3>
              <p>{source ? "Thumbnail indisponível" : "Prévia do conteúdo selecionado"}</p>
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          background: "rgba(0,0,0,.68)", borderRadius: 8, color: "white", fontSize: 12, fontWeight: 600,
          left: "50%", maxWidth: "82%", padding: "5px 9px", position: "absolute", textAlign: "center",
          top: `calc(${REACTION_SPLIT_PERCENT}% - 14px)`, transform: "translateX(-50%)", whiteSpace: "nowrap",
        }}
      >
        {normalizeQuickOverlayText(overlayText)}
      </div>

      {caption.trim() ? (
        <div
          className="text-xs"
          style={{
            background: "linear-gradient(180deg, transparent, rgba(0,0,0,.68))", bottom: 0, color: "white",
            left: 0, padding: "28px 12px 10px", position: "absolute", right: 0,
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}

export function SearchResultPreviewModal({
  onClose,
  source,
}: {
  onClose: () => void;
  source: QuickReactSource;
}) {
  const embed = buildEmbedUrl(source);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div className="panel" onClick={(event) => event.stopPropagation()} style={{ width: "100%", maxWidth: 980, padding: 20 }}>
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div>
            <div className="flex items-center gap-2">
              <Pill tone={platformTone(source.platform)}>{platformLabel(source.platform)}</Pill>
              <span className="text-lg">{source.title ?? "Preview"}</span>
            </div>
            <p className="page-subtitle">
              {source.author_username ? `${source.author_username} · ` : ""}
              {source.duration_s ? formatDuration(source.duration_s) : "Resultado externo"}
            </p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>

        {embed ? (
          <div
            className="overflow-hidden bg-black"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              margin: "0 auto",
              width: "100%",
              maxWidth: embed.platform === "instagram" ? 400 : 420,
              // Instagram's embed includes header/caption chrome, so it needs a
              // taller box than the pure 9:16 video players.
              ...(embed.platform === "instagram"
                ? { height: "72vh" }
                : { aspectRatio: "9 / 16", maxHeight: "72vh" }),
            }}
          >
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              scrolling="no"
              src={embed.src}
              style={{ border: 0, height: "100%", width: "100%" }}
              title={source.title ?? `${platformLabel(source.platform)} preview`}
            />
          </div>
        ) : (
          <div className="empty" style={{ minHeight: 420 }}>
            <div>
              <h3>Preview indisponível</h3>
              <p>Não foi possível incorporar este vídeo. Abra a origem para visualizar.</p>
              <a className={buttonVariants({ variant: "outline", className: "mt-4" })} href={source.result_url} rel="noreferrer" target="_blank">
                Abrir origem
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Build a per-platform embeddable iframe URL from the stored external id (with a
// URL-based fallback). YouTube/TikTok/Instagram all expose iframe-friendly embeds.
function buildEmbedUrl(source: QuickReactSource): { src: string; platform: ContentSearchPlatform } | null {
  if (source.platform === "youtube") {
    const id = source.external_id ?? extractYouTubeId(source.result_url);
    return id ? { src: `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1`, platform: "youtube" } : null;
  }
  if (source.platform === "tiktok") {
    const id = (source.external_id && /^\d+$/.test(source.external_id))
      ? source.external_id
      : source.result_url.match(/\/video\/(\d+)/)?.[1] ?? null;
    return id ? { src: `https://www.tiktok.com/embed/v2/${id}`, platform: "tiktok" } : null;
  }
  // instagram
  const code = source.external_id ?? source.result_url.match(/instagram\.com\/(?:reels?|p|tv)\/([\w-]+)/i)?.[1] ?? null;
  return code ? { src: `https://www.instagram.com/reel/${code}/embed`, platform: "instagram" } : null;
}

// --- Shared helpers ---------------------------------------------------------

export function platformLabel(platform: ContentSearchPlatform) {
  if (platform === "youtube") return "YouTube";
  if (platform === "tiktok") return "TikTok";
  return "Instagram";
}

export function platformTone(platform: ContentSearchPlatform) {
  if (platform === "youtube") return "info";
  if (platform === "tiktok") return "violet";
  return "reaction";
}

export function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, Math.trunc(totalSeconds % 60));
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function readQuickConfig(avatarId: string): QuickReactConfig | null {
  try {
    const raw = localStorage.getItem(quickConfigStorageKey(avatarId));
    if (!raw) {
      const legacyReactionId = localStorage.getItem(`avasyn:quick-reaction:${avatarId}`);
      return legacyReactionId
        ? { caption: QUICK_CAPTION_DEFAULT, overlayText: QUICK_OVERLAY_DEFAULT, reactionId: legacyReactionId }
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

export function persistQuickConfig(avatarId: string, config: QuickReactConfig) {
  localStorage.setItem(quickConfigStorageKey(avatarId), JSON.stringify({
    caption: config.caption.trim() || QUICK_CAPTION_DEFAULT,
    overlayText: normalizeQuickOverlayText(config.overlayText),
    reactionId: config.reactionId,
  }));
}

function quickConfigStorageKey(avatarId: string) {
  return `avasyn:quick-react-config:${avatarId}`;
}

export function normalizeQuickOverlayText(value: string) {
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
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace("/", "") || null;
    if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2] ?? null;
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

// Match a saved source video against an external result. We key on
// (platform, external_id) first because share URLs carry volatile tracking
// params — TikTok in particular rotates `u_code`/`_d` between scans, so the same
// clip yields a different URL each time and an exact source_url match misses
// (the importer dedupes by external id and never re-stores the new URL).
function sourceMatchesVideo(video: SourceVideo, source: QuickReactSource) {
  if (source.external_id && video.source_external_id) {
    return video.source_platform === source.platform && video.source_external_id === source.external_id;
  }
  return video.source_url === source.result_url;
}

async function findSourceVideoForSource(avatarId: string, source: QuickReactSource) {
  if (source.external_id) {
    const { data, error } = await supabase
      .from("source_videos")
      .select("*")
      .eq("avatar_id", avatarId)
      .eq("source_platform", source.platform)
      .eq("source_external_id", source.external_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as SourceVideo;
  }

  const { data, error } = await supabase
    .from("source_videos")
    .select("*")
    .eq("avatar_id", avatarId)
    .eq("source_url", source.result_url)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as SourceVideo) : null;
}

async function waitForImportCompletion(importId: string) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const { data, error } = await supabase.from("media_imports").select("*").eq("id", importId).single();
    if (error) throw error;
    const mediaImport = data as MediaImport;
    if (mediaImport.status === "completed" || mediaImport.status === "partial") return;
    if (mediaImport.status === "error") throw new Error(formatMediaImportError(mediaImport.error_message));
    await sleep(2000);
  }
  toast.info("Importação ainda em andamento. A biblioteca será atualizada quando terminar.");
}

function mergeSourceVideos(current: SourceVideo[], next: SourceVideo[]) {
  const byId = new Map<string, SourceVideo>();
  for (const video of [...current, ...next]) byId.set(video.id, video);
  return Array.from(byId.values());
}

export function formatMediaImportError(message: string | null) {
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
