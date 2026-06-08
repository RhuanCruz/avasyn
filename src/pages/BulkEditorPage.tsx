import {
  Dispatch,
  FormEvent,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import type { ReactionVideo, SocialAccount, SourceVideo } from "@/lib/types";

type CreateJobsResponse = {
  jobs?: Array<{ id: string }>;
};

type EditorSnapshot = {
  accounts: SocialAccount[];
  reactions: ReactionVideo[];
  sourceVideos: SourceVideo[];
};

export function BulkEditorPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const preferredAvatarId = searchParams.get("avatarId");
  const { avatars, selectedAvatar, selectedAvatarId, setSelectedAvatarId } = useAvatarState(preferredAvatarId);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [selectedReactionIds, setSelectedReactionIds] = useState<string[]>([]);
  const [caption, setCaption] = useState("Legenda curta de futebol com tom de reação");
  const [overlayText, setOverlayText] = useState("Frase simples de até 3 palavras sobre o lance");
  const [creating, setCreating] = useState(false);
  const [createdJobIds, setCreatedJobIds] = useState<string[]>([]);

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
      return { accounts: [], reactions: [], sourceVideos: [] };
    }

    const [sourceResult, reactionResult, accountsResult] = await Promise.all([
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
      supabase
        .from("social_accounts")
        .select("*")
        .eq("avatar_id", selectedAvatarId)
        .eq("active", true)
        .order("display_name"),
    ]);

    if (sourceResult.error) throw sourceResult.error;
    if (reactionResult.error) throw reactionResult.error;
    if (accountsResult.error) throw accountsResult.error;

    return {
      accounts: (accountsResult.data ?? []) as SocialAccount[],
      reactions: (reactionResult.data ?? []) as ReactionVideo[],
      sourceVideos: (sourceResult.data ?? []) as SourceVideo[],
    };
  }, [selectedAvatarId]);

  const snapshot = useSupabaseQuery(loadSnapshot, {
    accounts: [],
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
      <AppTopbar
        actions={
          <>
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
              Monte lotes do formato react(): base + reaction + texto + publicação.
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
                  <p>O avatar define biblioteca, reactions, contas e publicação.</p>
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

                  <div className="card card-pad" style={{ padding: 12 }}>
                    <div className="text-xs muted">direção para IA</div>
                    <div className="mt-3 grid gap-3">
                      <div className="thumb" style={{ maxWidth: 260, marginInline: "auto" }}>
                        <div className="thumb-art" style={{ color: "var(--text-muted)" }}>
                          PREVIEW
                        </div>
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
              accounts={snapshot.data.accounts}
              jobIds={createdJobIds}
              onScheduled={() => setCreatedJobIds((current) => [...current])}
            />
          </div>
        </div>
      </div>
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
  onToggle,
  selectedIds,
  title,
}: {
  emptyCtaHref: string;
  emptyText: string;
  items: Array<SourceVideo | ReactionVideo>;
  kind: "source" | "reaction";
  number: string;
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
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="col" style={{ gap: 6, minWidth: 0 }}>
                    <span className="truncate text-sm">{item.name}</span>
                    <MediaTonePill kind={kind === "source" ? "base" : "reaction"} />
                  </div>
                  <Button onClick={() => onToggle(item.id)} size="sm" variant={selected ? "default" : "outline"}>
                    {selected ? "Selecionado" : "Selecionar"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </StepCard>
  );
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
