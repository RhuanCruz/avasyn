import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "@/auth/AuthContext";
import {
  AppTopbar,
  AvatarSwitcher,
  Icon,
  MediaTonePill,
  Pill,
  formatDate,
  formatNumber,
} from "@/components/operator-ui";
import { StorageImagePreview, StorageVideoPreview } from "@/components/VideoPreview";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAvatarState } from "@/hooks/useAvatarState";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import { deleteStorageObject, getStorageUploadUrl } from "@/lib/storage-client";
import type { ReactionVideo, SourceVideo } from "@/lib/types";

type AddMode = "menu" | "upload-source" | "upload-reaction" | null;
type LibraryFilter = "all" | "source" | "reaction";

type LibrarySnapshot = {
  reactionVideos: ReactionVideo[];
  sourceVideos: SourceVideo[];
};


type PreviewItem =
  | { kind: "source"; video: SourceVideo }
  | { kind: "reaction"; video: ReactionVideo };

export function LibraryPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const preferredAvatarId = searchParams.get("avatarId");
  const filterParam = searchParams.get("kind");
  const initialFilter = filterParam === "reaction" ? "reaction" : "all";
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>(initialFilter);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const { avatars, selectedAvatar, selectedAvatarId, setSelectedAvatarId } = useAvatarState(preferredAvatarId);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedAvatarId) next.set("avatarId", selectedAvatarId);
    else next.delete("avatarId");
    if (filter === "reaction") next.set("kind", "reaction");
    else if (filter === "source") next.set("kind", "source");
    else next.delete("kind");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [filter, searchParams, selectedAvatarId, setSearchParams]);

  const loadSnapshot = useCallback(async (): Promise<LibrarySnapshot> => {
    if (!selectedAvatarId) {
      return { reactionVideos: [], sourceVideos: [] };
    }

    const [sourceResult, reactionResult] = await Promise.all([
      supabase
        .from("source_videos")
        .select("*")
        .eq("avatar_id", selectedAvatarId)
        .order("created_at", { ascending: false }),
      supabase
        .from("reaction_videos")
        .select("*")
        .eq("avatar_id", selectedAvatarId)
        .order("created_at", { ascending: false }),
    ]);

    if (sourceResult.error) throw sourceResult.error;
    if (reactionResult.error) throw reactionResult.error;

    return {
      reactionVideos: (reactionResult.data ?? []) as ReactionVideo[],
      sourceVideos: (sourceResult.data ?? []) as SourceVideo[],
    };
  }, [selectedAvatarId]);

  const snapshot = useSupabaseQuery(loadSnapshot, {
    reactionVideos: [],
    sourceVideos: [],
  });

  useEffect(() => {
    if (!user || !selectedAvatarId) return;

    const channel = supabase
      .channel(`media-library-${user.id}-${selectedAvatarId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "source_videos",
        filter: `avatar_id=eq.${selectedAvatarId}`,
      }, () => {
        void snapshot.refresh();
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "reaction_videos",
        filter: `avatar_id=eq.${selectedAvatarId}`,
      }, () => {
        void snapshot.refresh();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedAvatarId, snapshot.refresh, user]);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!user || files.length === 0 || !selectedAvatarId) return;

    const uploadKind = addMode === "upload-reaction" ? "reaction" : "source";
    const bucket = uploadKind === "reaction" ? "reaction-videos" : "source-videos";
    setUploading(true);

    try {
      for (const file of files) {
        const { path, uploadUrl } = await getStorageUploadUrl(bucket, file.name, file.type);
        const uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!uploadResponse.ok) throw new Error("Falha no upload do arquivo");

        if (uploadKind === "reaction") {
          const { error } = await supabase.from("reaction_videos").insert({
            avatar_id: selectedAvatarId,
            user_id: user.id,
            name: file.name,
            storage_path: path,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.from("source_videos").insert({
            avatar_id: selectedAvatarId,
            user_id: user.id,
            name: file.name,
            storage_path: path,
            source_type: "upload",
          });
          if (error) throw error;
        }
      }

      toast.success(`${files.length} mídia(s) adicionadas`);
      setAddMode(null);
      await snapshot.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no upload");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function removeSelected() {
    const sourceIds = selectedKeys
      .filter((key) => key.startsWith("source:"))
      .map((key) => key.slice("source:".length));
    const reactionIds = selectedKeys
      .filter((key) => key.startsWith("reaction:"))
      .map((key) => key.slice("reaction:".length));

    try {
      const sourceVideos = snapshot.data.sourceVideos.filter((video) => sourceIds.includes(video.id));
      const reactionVideos = snapshot.data.reactionVideos.filter((video) => reactionIds.includes(video.id));

      if (sourceVideos.length > 0) {
        await deleteStorageObject("source-videos", sourceVideos.map((video) => video.storage_path));

        const thumbnailPaths = sourceVideos.flatMap((video) =>
          video.thumbnail_path ? [video.thumbnail_path] : []);
        if (thumbnailPaths.length > 0) {
          await deleteStorageObject("source-thumbnails", thumbnailPaths);
        }

        const { error: deleteSourceRowsError } = await supabase
          .from("source_videos")
          .delete()
          .in("id", sourceIds);
        if (deleteSourceRowsError) throw deleteSourceRowsError;
      }

      if (reactionVideos.length > 0) {
        await deleteStorageObject("reaction-videos", reactionVideos.map((video) => video.storage_path));

        const { error: deleteReactionRowsError } = await supabase
          .from("reaction_videos")
          .delete()
          .in("id", reactionIds);
        if (deleteReactionRowsError) throw deleteReactionRowsError;
      }

      setSelectedKeys([]);
      toast.success("Mídias removidas");
      await snapshot.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover mídias");
    }
  }

  const visibleSourceVideos = filter === "reaction" ? [] : snapshot.data.sourceVideos;
  const visibleReactionVideos = filter === "source" ? [] : snapshot.data.reactionVideos;
  const visibleCount = visibleSourceVideos.length + visibleReactionVideos.length;
  const selectedBaseCount = selectedKeys.filter((key) => key.startsWith("source:")).length;
  const selectedReactionCount = selectedKeys.filter((key) => key.startsWith("reaction:")).length;

  return (
    <>
      <AppTopbar
        actions={
          <>
            <AvatarSwitcher
              avatars={avatars}
              includeAll={false}
              onChange={setSelectedAvatarId}
              selectedAvatarId={selectedAvatarId}
            />
            <div style={{ position: "relative" }}>
              <Button disabled={!selectedAvatarId} onClick={() => setAddMode(addMode ? null : "menu")}>
                <Icon name="plus" />
                Adicionar mídia
              </Button>
              {addMode ? (
                <AddMediaPanel
                  mode={addMode}
                  onChoose={setAddMode}
                  onClose={() => setAddMode(null)}
                  onUpload={() => fileInputRef.current?.click()}
                  uploading={uploading}
                />
              ) : null}
              <input
                accept="video/*,video/mp4,video/quicktime,video/webm"
                className="sr-only"
                multiple
                onChange={(event) => void handleFiles(event)}
                ref={fileInputRef}
                type="file"
              />
            </div>
          </>
        }
        crumbs={[
          { label: "Workspace", icon: "home", href: "/" },
          { label: "Biblioteca", icon: "library" },
        ]}
      />

      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Biblioteca</h1>
            <p className="page-subtitle">
              Centralize vídeos base e reactions por avatar antes de produzir combinações.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedAvatar ? <Pill tone="violet">{selectedAvatar.name}</Pill> : null}
            <Link className={buttonVariants({ variant: "outline" })} to="/avatars">
              Avatares
            </Link>
          </div>
        </div>

        <section className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
          <div className="panel card-pad">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-lg">Contexto de avatar</div>
                <p className="page-subtitle">Toda mídia nova entra já associada ao avatar selecionado.</p>
              </div>
              <AvatarSwitcher
                avatars={avatars}
                includeAll={false}
                onChange={setSelectedAvatarId}
                selectedAvatarId={selectedAvatarId}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {[
                ["all", "Tudo", visibleCount],
                ["source", "Vídeos base", snapshot.data.sourceVideos.length],
                ["reaction", "Reactions", snapshot.data.reactionVideos.length],
              ].map(([value, label, count]) => (
                <button
                  className={`tab ${filter === value ? "active" : ""}`}
                  key={value}
                  onClick={() => setFilter(value as LibraryFilter)}
                  type="button"
                >
                  {label}
                  <span className="count">{count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel card-pad">
            <div className="text-lg">Resumo</div>
            <p className="page-subtitle">Estoques e seleção atual da biblioteca.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="card card-pad">
                <div className="text-xs muted">itens visíveis</div>
                <div className="num" style={{ fontSize: 24, marginTop: 8 }}>{visibleCount}</div>
              </div>
              <div className="card card-pad">
                <div className="text-xs muted">selecionados</div>
                <div className="num" style={{ fontSize: 24, marginTop: 8 }}>{selectedKeys.length}</div>
              </div>
              <div className="card card-pad">
                <div className="text-xs muted">base</div>
                <div className="num" style={{ fontSize: 24, marginTop: 8 }}>{selectedBaseCount}</div>
              </div>
              <div className="card card-pad">
                <div className="text-xs muted">reactions</div>
                <div className="num" style={{ fontSize: 24, marginTop: 8 }}>{selectedReactionCount}</div>
              </div>
            </div>
            {selectedKeys.length > 0 ? (
              <Button className="mt-4 w-full" onClick={() => void removeSelected()} variant="outline">
                <Icon name="trash" />
                Remover selecionadas ({selectedKeys.length})
              </Button>
            ) : null}
          </div>
        </section>

        {!selectedAvatarId ? (
          <div className="panel empty mt-4">
            <div>
              <h3>Selecione um avatar</h3>
              <p>O avatar define o contexto de mídia, contas e geração.</p>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <MediaSection
              emptyText="Nenhum vídeo base neste avatar."
              kind="source"
              onPreview={(video) => setPreview({ kind: "source", video: video as SourceVideo })}
              onToggle={toggleSelection}
              selectedKeys={selectedKeys}
              title="Vídeos base"
              videos={visibleSourceVideos}
            />
            <MediaSection
              emptyText="Nenhuma reaction neste avatar."
              kind="reaction"
              onPreview={(video) => setPreview({ kind: "reaction", video: video as ReactionVideo })}
              onToggle={toggleSelection}
              selectedKeys={selectedKeys}
              title="Reactions"
              videos={visibleReactionVideos}
            />
          </div>
        )}

        {preview ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
            onClick={() => setPreview(null)}
          >
            <div
              className="panel"
              onClick={(event) => event.stopPropagation()}
              style={{ width: "100%", maxWidth: 960, padding: 20 }}
            >
              <div className="page-header" style={{ marginBottom: 16 }}>
                <div>
                  <div className="flex items-center gap-2">
                    <MediaTonePill kind={preview.kind === "source" ? "base" : "reaction"} />
                    <span className="text-lg">{preview.video.name}</span>
                  </div>
                  <p className="page-subtitle">
                    {preview.kind === "source" ? "Preview do video base." : "Preview da reaction."}
                  </p>
                </div>
                <Button onClick={() => setPreview(null)} size="sm" variant="outline">
                  <Icon name="x" />
                </Button>
              </div>
              <StorageVideoPreview
                bucket={preview.kind === "source" ? "source-videos" : "reaction-videos"}
                path={preview.video.storage_path}
                title={preview.video.name}
              />
            </div>
          </div>
        ) : null}
     </div>
    </>
  );

  function toggleSelection(key: string) {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((currentKey) => currentKey !== key)
        : [...current, key],
    );
  }

}

function MediaSection({
  emptyText,
  kind,
  onPreview,
  onToggle,
  selectedKeys,
  title,
  videos,
}: {
  emptyText: string;
  kind: "source" | "reaction";
  onPreview: (video: SourceVideo | ReactionVideo) => void;
  onToggle: (key: string) => void;
  selectedKeys: string[];
  title: string;
  videos: Array<SourceVideo | ReactionVideo>;
}) {
  return (
    <section className="panel card-pad">
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h2 className="text-lg">{title}</h2>
          <p className="page-subtitle">
            {kind === "source"
              ? "Assets principais usados como lance, clip ou edit."
              : "Banco de reactions do módulo react()."}
          </p>
        </div>
        <Pill tone={kind === "source" ? "base" : "reaction"}>{videos.length} itens</Pill>
      </div>

      {videos.length === 0 ? (
        <div className="empty" style={{ padding: "40px 12px" }}>
          <div>
            <h3>Nada carregado</h3>
            <p>{emptyText}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {videos.map((video) => {
            const key = `${kind}:${video.id}`;
            const selected = selectedKeys.includes(key);
            const isSource = kind === "source";
            const sourceVideo = video as SourceVideo;

            return (
              <article className="card card-pad" key={key}>
                <div
                  style={{
                    borderRadius: 8,
                    boxShadow: selected
                      ? `0 0 0 3px ${isSource ? "var(--base-bg)" : "var(--reaction-bg)"}`
                      : "none",
                  }}
                >
                  {isSource && sourceVideo.thumbnail_path ? (
                    <StorageImagePreview
                      aspect="reel"
                      path={sourceVideo.thumbnail_path}
                      title={video.name}
                    />
                  ) : (
                    <StorageVideoPreview
                      aspect="reel"
                      bucket={isSource ? "source-videos" : "reaction-videos"}
                      path={video.storage_path}
                      showTitle={false}
                      title={video.name}
                    />
                  )}
                </div>
                <div className="mt-3 flex items-start justify-between gap-3">
                  <div className="col" style={{ gap: 6, minWidth: 0 }}>
                    <span className="truncate text-sm">{video.name}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <MediaTonePill kind={isSource ? "base" : "reaction"} />
                      {isSource ? (
                        <Pill tone="neutral">{sourceLabel(sourceVideo.source_type)}</Pill>
                      ) : null}
                    </div>
                  </div>
                </div>
                {isSource ? (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs muted">
                    {sourceVideo.view_count ? <span>{formatNumber(sourceVideo.view_count)} views</span> : null}
                    {sourceVideo.like_count ? <span>{formatNumber(sourceVideo.like_count)} likes</span> : null}
                    <span>{formatDate(sourceVideo.source_published_at ?? sourceVideo.created_at)}</span>
                  </div>
                ) : (
                  <div className="mt-3 text-xs muted">{formatDate(video.created_at)}</div>
                )}
                <div className="mt-4 flex gap-2">
                  <Button className="flex-1" onClick={() => onPreview(video)} size="sm" variant="outline">
                    Ver
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => onToggle(key)}
                    size="sm"
                    variant={selected ? "default" : "outline"}
                  >
                    {selected ? "Selecionado" : "Selecionar"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AddMediaPanel({
  mode,
  onChoose,
  onClose,
  onUpload,
  uploading,
}: {
  mode: AddMode;
  onChoose: (mode: AddMode) => void;
  onClose: () => void;
  onUpload: () => void;
  uploading: boolean;
}) {
  return (
    <div className="panel" style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 360, padding: 16, zIndex: 30 }}>
      <div className="page-header" style={{ marginBottom: 14 }}>
        <div>
          <h2 className="text-lg">Adicionar mídia</h2>
          <p className="page-subtitle">Escolha como o conteúdo entra no avatar.</p>
        </div>
        <Button onClick={onClose} size="sm" variant="outline">
          <Icon name="x" />
        </Button>
      </div>
      {mode === "menu" ? (
        <div className="grid gap-2">
          <Button onClick={() => onChoose("upload-source")} variant="outline">
            <Icon name="upload" />
            Enviar vídeo base
          </Button>
          <Button onClick={() => onChoose("upload-reaction")} variant="outline">
            <Icon name="reaction" />
            Enviar reaction
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-sm muted">
            {mode === "upload-source"
              ? "Selecione um ou mais vídeos base do seu computador."
              : "Selecione um ou mais vídeos de reaction do seu computador."}
          </p>
          <Button disabled={uploading} onClick={onUpload}>
            <Icon name="upload" />
            {uploading ? "Enviando..." : "Escolher arquivos"}
          </Button>
          <Button onClick={() => onChoose("menu")} variant="outline">
            Voltar
          </Button>
        </div>
      )}
    </div>
  );
}

function sourceLabel(sourceType: string) {
  if (sourceType === "upload") return "arquivo";
  return "importado";
}
