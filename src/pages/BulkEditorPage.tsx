import {
  Dispatch,
  FormEvent,
  PointerEvent,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import {
  AppTopbar,
  AvatarSwitcher,
  Icon,
  MediaTonePill,
  Pill,
} from "@/components/operator-ui";
import { GeneratedJobsPanel } from "@/components/GeneratedJobsPanel";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAvatarState } from "@/hooks/useAvatarState";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { getStorageSignedUrl } from "@/lib/storage-client";
import type { ReactionVideo, SourceVideo } from "@/lib/types";

type CreateJobsResponse = {
  jobs?: Array<{ id: string }>;
};

type EditorSnapshot = {
  reactions: ReactionVideo[];
  sourceVideos: SourceVideo[];
};

export function BulkEditorPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const preferredAvatarId = searchParams.get("avatarId");
  const { avatars, selectedAvatar, selectedAvatarId, setSelectedAvatarId } = useAvatarState(preferredAvatarId);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [selectedReactionIds, setSelectedReactionIds] = useState<string[]>([]);
  const [caption, setCaption] = useState("Legenda curta de futebol com tom de reação");
  const [overlayText, setOverlayText] = useState("Frase simples de até 3 palavras sobre o lance");
  const [noOverlay, setNoOverlay] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdJobIds, setCreatedJobIds] = useState<string[]>([]);
  const [positioningReaction, setPositioningReaction] = useState<ReactionVideo | null>(null);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedAvatarId) next.set("avatarId", selectedAvatarId);
    else next.delete("avatarId");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, selectedAvatarId, setSearchParams]);

  const loadSnapshot = useCallback(async (): Promise<EditorSnapshot> => {
    if (!selectedAvatarId) {
      return { reactions: [], sourceVideos: [] };
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
      reactions: (reactionResult.data ?? []) as ReactionVideo[],
      sourceVideos: (sourceResult.data ?? []) as SourceVideo[],
    };
  }, [selectedAvatarId]);

  const snapshot = useSupabaseQuery(loadSnapshot, {
    reactions: [],
    sourceVideos: [],
  });

  const totalCombinations = selectedSourceIds.length * selectedReactionIds.length;
  const selectedSourceVideos = useMemo(
    () => snapshot.data.sourceVideos.filter((video) => selectedSourceIds.includes(video.id)),
    [selectedSourceIds, snapshot.data.sourceVideos],
  );
  const selectedReactions = useMemo(
    () => snapshot.data.reactions.filter((reaction) => selectedReactionIds.includes(reaction.id)),
    [selectedReactionIds, snapshot.data.reactions],
  );

  useEffect(() => {
    setSelectedSourceIds([]);
    setSelectedReactionIds([]);
    setCreatedJobIds([]);
  }, [selectedAvatarId]);

  async function handleCreateJobs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAvatarId) {
      toast.error("Selecione um avatar");
      return;
    }

    setCreating(true);

    try {
      const response = await invokeFunction<CreateJobsResponse>("create-bulk-jobs", {
        avatarId: selectedAvatarId,
        sourceVideoIds: selectedSourceIds,
        reactionIds: selectedReactionIds,
        caption,
        overlayText: noOverlay ? "" : overlayText,
        noOverlay,
      });
      const jobIds = response.jobs?.map((job) => job.id) ?? [];
      setCreatedJobIds(jobIds);
      toast.success(`${jobIds.length} job(s) enviados para renderização`);
      navigate(`/avatars/${selectedAvatarId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar jobs");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <AppTopbar
        actions={
          <>
            <div className="sv-format-toggle">
              <button
                onClick={() => navigate(selectedAvatarId ? `/avatars/${selectedAvatarId}/videos/new` : "/avatars")}
                type="button"
              >
                Vídeo roteirizado
              </button>
              <button className="active" type="button">React</button>
            </div>
            <AvatarSwitcher
              avatars={avatars}
              includeAll={false}
              onChange={setSelectedAvatarId}
              selectedAvatarId={selectedAvatarId}
            />
            <Link
              className={buttonVariants({ variant: "outline" })}
              to={selectedAvatarId ? `/avatars/${selectedAvatarId}` : "/avatars"}
            >
              Abrir avatar
            </Link>
          </>
        }
        crumbs={[
          { label: "Workspace", icon: "home", href: "/" },
          { label: "Editor em massa", icon: "wand" },
        ]}
      />

      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Editor em massa</h1>
            <p className="page-subtitle">
              Monte lotes do formato React: base + reaction + texto + renderização.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedAvatar ? <Pill tone="violet">{selectedAvatar.name}</Pill> : null}
            <Link className={buttonVariants({ variant: "outline" })} to="/library">
              Biblioteca
            </Link>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
          <div className="flex flex-col gap-4">
            <StepCard
              description="Todo job criado aqui pertence ao avatar selecionado."
              number="01"
              title="Escolha o avatar"
            >
              <AvatarSwitcher
                avatars={avatars}
                includeAll={false}
                onChange={setSelectedAvatarId}
                selectedAvatarId={selectedAvatarId}
              />
            </StepCard>

            {!selectedAvatarId ? (
              <div className="panel empty">
                <div>
                  <h3>Selecione um avatar</h3>
                  <p>O avatar define biblioteca, reactions e direção editorial.</p>
                </div>
              </div>
            ) : (
              <>
                <MediaPicker
                  emptyCtaHref="/library"
                  emptyText="Nenhum vídeo base encontrado neste avatar."
                  items={snapshot.data.sourceVideos}
                  kind="source"
                  number="02"
                  onToggle={(id) => toggleId(id, setSelectedSourceIds)}
                  selectedIds={selectedSourceIds}
                  title="Vídeos base"
                />
                <MediaPicker
                  emptyCtaHref={`/library?avatarId=${selectedAvatarId}&kind=reaction`}
                  emptyText="Nenhuma reaction encontrada neste avatar."
                  items={snapshot.data.reactions}
                  kind="reaction"
                  number="03"
                  onPosition={setPositioningReaction}
                  onToggle={(id) => toggleId(id, setSelectedReactionIds)}
                  selectedIds={selectedReactionIds}
                  title="Reactions"
                />
              </>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <StepCard
              description={
                totalCombinations === 0
                  ? "Selecione vídeos base e reactions para montar o lote."
                  : `${selectedSourceIds.length} vídeo(s) base x ${selectedReactionIds.length} reaction(s) = ${totalCombinations} job(s) com textos únicos por IA.`
              }
              number="04"
              title="Configuração editorial"
            >
              <form onSubmit={handleCreateJobs}>
                <FieldGroup>
                  <SelectionSummary reactions={selectedReactions} sourceVideos={selectedSourceVideos} />

                  <Field>
                    <FieldLabel htmlFor="bulk-caption">Direção da legenda</FieldLabel>
                    <Textarea
                      id="bulk-caption"
                      onChange={(event) => setCaption(event.target.value)}
                      required
                      rows={5}
                      value={caption}
                    />
                  </Field>

                  <Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        checked={noOverlay}
                        onChange={(event) => setNoOverlay(event.target.checked)}
                        type="checkbox"
                      />
                      Sem texto de overlay
                    </label>
                  </Field>

                  {!noOverlay ? (
                    <Field>
                      <FieldLabel htmlFor="bulk-overlay">Direção do texto da divisão</FieldLabel>
                      <Input
                        id="bulk-overlay"
                        onChange={(event) => setOverlayText(event.target.value)}
                        required
                        value={overlayText}
                      />
                      <FieldDescription>
                        A IA gera uma frase final única com no máximo 3 palavras para cada vídeo.
                      </FieldDescription>
                    </Field>
                  ) : null}

                  <div className="card card-pad" style={{ padding: 12 }}>
                    <div className="text-xs muted">direção para IA</div>
                    <div className="mt-3 grid gap-3">
                      <div className="thumb" style={{ maxWidth: 260, marginInline: "auto" }}>
                        <div className="thumb-art" style={{ color: "var(--text-muted)" }}>
                          PREVIEW
                        </div>
                        {!noOverlay ? (
                          <div style={{ position: "absolute", top: "43%", insetInline: 16 }}>
                            <div
                              style={{
                                background: "rgba(0,0,0,0.76)",
                                border: "1px solid var(--border)",
                                borderRadius: 10,
                                padding: "10px 12px",
                                textAlign: "center",
                                fontSize: 12,
                                fontWeight: 600,
                                letterSpacing: "0.04em",
                              }}
                            >
                              {overlayText || "Direção do overlay"}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <p className="text-sm muted">{caption}</p>
                      <p className="text-xs muted">
                        Os textos finais são gerados automaticamente ao criar os jobs.
                      </p>
                    </div>
                  </div>

                  <Button
                    disabled={creating || totalCombinations === 0 || totalCombinations > 100}
                    type="submit"
                  >
                    <Icon name="wand" />
                    {creating ? "Criando jobs..." : "05. Gerar combinações"}
                  </Button>
                </FieldGroup>
              </form>
            </StepCard>

            <GeneratedJobsPanel
              jobIds={createdJobIds}
            />
          </div>
        </div>
      </div>
      {positioningReaction ? (
        <ReactionPositionModal
          onClose={() => setPositioningReaction(null)}
          onSaved={async () => {
            setPositioningReaction(null);
            await snapshot.refresh();
          }}
          reaction={positioningReaction}
        />
      ) : null}
    </>
  );
}

function StepCard({
  children,
  description,
  number,
  title,
}: {
  children: React.ReactNode;
  description: string;
  number: string;
  title: string;
}) {
  return (
    <section className="panel card-pad">
      <div className="flex items-start gap-4">
        <div
          className="av-bubble lg"
          style={{ background: "var(--accent-bg)", color: "var(--accent-hover)", borderRadius: 12 }}
        >
          {number}
        </div>
        <div className="col" style={{ gap: 4, flex: 1 }}>
          <div className="text-lg">{title}</div>
          <p className="page-subtitle" style={{ marginTop: 0 }}>{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function MediaPicker({
  emptyCtaHref,
  emptyText,
  items,
  kind,
  number,
  onPosition,
  onToggle,
  selectedIds,
  title,
}: {
  emptyCtaHref: string;
  emptyText: string;
  items: Array<SourceVideo | ReactionVideo>;
  kind: "source" | "reaction";
  number: string;
  onPosition?: (reaction: ReactionVideo) => void;
  onToggle: (id: string) => void;
  selectedIds: string[];
  title: string;
}) {
  return (
    <StepCard
      description={
        kind === "source"
          ? "Selecione os clipes ou lances que entram nas combinações."
          : "Selecione uma ou mais reactions para multiplicar a saída."
      }
      number={number}
      title={title}
    >
      {items.length === 0 ? (
        <div className="empty" style={{ padding: "40px 12px" }}>
          <div>
            <h3>Nada disponível</h3>
            <p>{emptyText}</p>
            <Link className={buttonVariants({ className: "mt-4", variant: "outline" })} to={emptyCtaHref}>
              Abrir biblioteca
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const selected = selectedIds.includes(item.id);
            const reaction = item as ReactionVideo;
            return (
              <article className="card card-pad" key={item.id}>
                <div
                  style={{
                    borderRadius: 8,
                    boxShadow: selected
                      ? `0 0 0 3px ${kind === "source" ? "var(--base-bg)" : "var(--reaction-bg)"}`
                      : "none",
                  }}
                >
                  <StorageVideoPreview
                    aspect="reel"
                    bucket={kind === "source" ? "source-videos" : "reaction-videos"}
                    path={item.storage_path}
                    showTitle={false}
                    title={item.name}
                  />
                </div>
                <div className="mt-3 flex items-start justify-between gap-3">
                  <div className="col" style={{ gap: 6, minWidth: 0 }}>
                    <span className="truncate text-sm">{item.name}</span>
                    <MediaTonePill kind={kind === "source" ? "base" : "reaction"} />
                    {kind === "reaction" ? (
                      <span className="text-xs muted">
                        Posição: {Math.round(reaction.position_x ?? 0)}, {Math.round(reaction.position_y ?? 0)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <Button onClick={() => onToggle(item.id)} size="sm" variant={selected ? "default" : "outline"}>
                      {selected ? "Selecionado" : "Selecionar"}
                    </Button>
                    {kind === "reaction" && selected && onPosition ? (
                      <Button onClick={() => onPosition(reaction)} size="sm" variant="outline">
                        Posicionar
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </StepCard>
  );
}

function ReactionPositionModal({
  onClose,
  onSaved,
  reaction,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
  reaction: ReactionVideo;
}) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [position, setPosition] = useState({
    x: reaction.position_x ?? 0,
    y: reaction.position_y ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const ratioX = positionToRatio(position.x);
  const ratioY = positionToRatio(position.y);

  useEffect(() => {
    let active = true;
    async function loadUrl() {
      const url = await getStorageSignedUrl("reaction-videos", reaction.storage_path).catch(() => null);
      if (active) setVideoUrl(url);
    }
    void loadUrl();
    return () => {
      active = false;
    };
  }, [reaction.storage_path]);

  function setAxis(axis: "x" | "y", value: number) {
    setPosition((current) => ({ ...current, [axis]: clampPosition(value) }));
  }

  function handlePointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = previewRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const topBoundsHeight = bounds.height * 0.35;
    const nextX = ((event.clientX - bounds.left) / bounds.width) * 200 - 100;
    const nextY = ((event.clientY - bounds.top) / topBoundsHeight) * 200 - 100;

    setPosition({
      x: clampPosition(nextX),
      y: clampPosition(nextY),
    });
  }

  async function savePosition() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("reaction_videos")
        .update({
          position_x: Math.round(position.x),
          position_y: Math.round(position.y),
        })
        .eq("id", reaction.id)
        .eq("avatar_id", reaction.avatar_id);
      if (error) throw error;
      toast.success("Posição da reaction salva");
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar posição");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="panel"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "100%", maxWidth: 760, padding: 20 }}
      >
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div>
            <h2 className="text-lg">Posicionar reaction</h2>
            <p className="page-subtitle">
              Ajuste o rosto dentro da parte superior do split antes de gerar o lote.
            </p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            Fechar
          </Button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
          <div
            className="mx-auto w-full max-w-[360px] overflow-hidden rounded-lg border border-border bg-black"
            ref={previewRef}
            style={{ aspectRatio: "9 / 16" }}
          >
            <div
              className="relative cursor-crosshair overflow-hidden bg-black"
              onPointerDown={handlePointer}
              onPointerMove={(event) => {
                if (event.buttons === 1) handlePointer(event);
              }}
              style={{ height: "35%" }}
            >
              {videoUrl ? (
                <video
                  autoPlay
                  className="absolute inset-0 h-full w-full object-cover"
                  loop
                  muted
                  playsInline
                  src={videoUrl}
                  style={{ objectPosition: `${ratioX * 100}% ${ratioY * 100}%` }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm muted">
                  Carregando reaction...
                </div>
              )}
            </div>
            <div className="relative flex items-center justify-center bg-[var(--surface)]" style={{ height: "65%" }}>
              <div
                style={{
                  background: "rgba(0,0,0,0.76)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: "white",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "10px 12px",
                  position: "absolute",
                  textAlign: "center",
                  top: -22,
                }}
              >
                texto da divisão
              </div>
              <span className="text-sm muted">vídeo base 65%</span>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <div className="text-md">{reaction.name}</div>
              <p className="page-subtitle">
                Arraste o vídeo no topo ou use os controles abaixo. O render final usa esses mesmos valores.
              </p>
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="reaction-position-x">Horizontal</FieldLabel>
                <Input
                  id="reaction-position-x"
                  max={100}
                  min={-100}
                  onChange={(event) => setAxis("x", Number(event.target.value))}
                  step={1}
                  type="range"
                  value={position.x}
                />
                <div className="text-xs muted">{Math.round(position.x)}</div>
              </Field>
              <Field>
                <FieldLabel htmlFor="reaction-position-y">Vertical</FieldLabel>
                <Input
                  id="reaction-position-y"
                  max={100}
                  min={-100}
                  onChange={(event) => setAxis("y", Number(event.target.value))}
                  step={1}
                  type="range"
                  value={position.y}
                />
                <div className="text-xs muted">{Math.round(position.y)}</div>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setPosition({ x: 0, y: 0 })} type="button" variant="outline">
                  Centralizar
                </Button>
                <Button disabled={saving} onClick={() => void savePosition()} type="button">
                  {saving ? "Salvando..." : "Salvar posição"}
                </Button>
              </div>
            </FieldGroup>
          </div>
        </div>
      </div>
    </div>
  );
}

function positionToRatio(value: number) {
  return (clampPosition(value) + 100) / 200;
}

function clampPosition(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-100, Math.min(100, value));
}

function SelectionSummary({
  reactions,
  sourceVideos,
}: {
  reactions: ReactionVideo[];
  sourceVideos: SourceVideo[];
}) {
  if (sourceVideos.length === 0 && reactions.length === 0) return null;

  return (
    <div className="card card-pad">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="col" style={{ gap: 8 }}>
          <div className="flex items-center gap-2">
            <MediaTonePill kind="base" />
            <span className="text-sm">{sourceVideos.length} vídeo(s)</span>
          </div>
          {sourceVideos.map((video) => (
            <span className="truncate text-xs muted" key={video.id}>
              {video.name}
            </span>
          ))}
        </div>
        <div className="col" style={{ gap: 8 }}>
          <div className="flex items-center gap-2">
            <MediaTonePill kind="reaction" />
            <span className="text-sm">{reactions.length} reaction(s)</span>
          </div>
          {reactions.map((reaction) => (
            <span className="truncate text-xs muted" key={reaction.id}>
              {reaction.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function toggleId(id: string, setIds: Dispatch<SetStateAction<string[]>>) {
  setIds((current) =>
    current.includes(id)
      ? current.filter((currentId) => currentId !== id)
      : [...current, id],
  );
}
