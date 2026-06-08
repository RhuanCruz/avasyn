import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  AppTopbar,
  AvatarBubble,
  AvatarSwitcher,
  Icon,
  Pill,
  StatusPill,
} from "@/components/operator-ui";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAvatarState } from "@/hooks/useAvatarState";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { createAvatarPhotoUrl, removeAvatarPhoto, uploadAvatarPhoto } from "@/lib/avatar-photo";
import { slugifyAvatarName } from "@/lib/avatar-utils";
import { supabase } from "@/lib/supabase";
import type {
  Avatar,
  AvatarStatus,
  ReactionVideo,
  ReelJob,
  SourceVideo,
} from "@/lib/types";

type AvatarSnapshot = {
  avatar: Avatar | null;
  sourceVideos: SourceVideo[];
  reactionVideos: ReactionVideo[];
  jobs: ReelJob[];
};

type HubTab = "overview" | "biblioteca" | "sobre";

export function AvatarDetailPage() {
  const params = useParams<{ avatarId: string }>();
  const avatarId = params.avatarId ?? null;
  const {
    avatars,
    refresh: refreshAvatars,
    selectedAvatarId,
    setSelectedAvatarId,
  } = useAvatarState(avatarId);
  const [tab, setTab] = useState<HubTab>("overview");
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    name: "",
    personaSummary: "",
    about: "",
    status: "active" as AvatarStatus,
  });
  const photoPreviewUrl = useMemo(
    () => (photoFile ? URL.createObjectURL(photoFile) : null),
    [photoFile],
  );

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  const loadSnapshot = useCallback(async (): Promise<AvatarSnapshot> => {
    if (!avatarId) {
      return {
        avatar: null,
        sourceVideos: [],
        reactionVideos: [],
        jobs: [],
      };
    }

    const [
      avatarResult,
      sourceVideosResult,
      reactionVideosResult,
      jobsResult,
    ] = await Promise.all([
      supabase.from("avatars").select("*").eq("id", avatarId).maybeSingle(),
      supabase
        .from("source_videos")
        .select("*")
        .eq("avatar_id", avatarId)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("reaction_videos")
        .select("*")
        .eq("avatar_id", avatarId)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("reel_jobs")
        .select("*")
        .eq("avatar_id", avatarId)
        .order("created_at", { ascending: false })
        .limit(16),
    ]);

    if (avatarResult.error) throw avatarResult.error;
    if (sourceVideosResult.error) throw sourceVideosResult.error;
    if (reactionVideosResult.error) throw reactionVideosResult.error;
    if (jobsResult.error) throw jobsResult.error;

    return {
      avatar: (avatarResult.data ?? null) as Avatar | null,
      sourceVideos: (sourceVideosResult.data ?? []) as SourceVideo[],
      reactionVideos: (reactionVideosResult.data ?? []) as ReactionVideo[],
      jobs: (jobsResult.data ?? []) as ReelJob[],
    };
  }, [avatarId]);

  const snapshot = useSupabaseQuery(loadSnapshot, {
    avatar: null,
    sourceVideos: [],
    reactionVideos: [],
    jobs: [],
  });

  const avatar = snapshot.data.avatar;
  const siblingAvatars = useMemo(
    () => avatars.filter((candidate) => candidate.id !== avatar?.id),
    [avatar?.id, avatars],
  );

  useEffect(() => {
    if (!avatar) return;
    setSelectedAvatarId(avatar.id);
    setForm({
      name: avatar.name,
      personaSummary: avatar.persona_summary ?? "",
      about: avatar.about ?? "",
      status: avatar.status,
    });
    setPhotoFile(null);
  }, [avatar, setSelectedAvatarId]);

  async function saveAvatar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!avatar) return;

    setSaving(true);
    try {
      const slug = buildUniqueAvatarSlug(siblingAvatars, form.name);
      const nextPhotoPath = photoFile
        ? await uploadAvatarPhoto(avatar.user_id, photoFile)
        : avatar.photo_path;
      const { error } = await supabase
        .from("avatars")
        .update({
          name: form.name.trim(),
          slug,
          persona_summary: form.personaSummary.trim() || null,
          about: form.about.trim() || null,
          photo_path: nextPhotoPath,
          status: form.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", avatar.id);

      if (error) throw error;
      if (photoFile && avatar.photo_path && avatar.photo_path !== nextPhotoPath) {
        await removeAvatarPhoto(avatar.photo_path);
      }
      setPhotoFile(null);

      await Promise.all([snapshot.refresh(), refreshAvatars()]);
      toast.success("Avatar atualizado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar avatar");
    } finally {
      setSaving(false);
    }
  }

  if (!avatarId) {
    return <div className="page"><div className="panel empty"><div><h3>Avatar invalido</h3></div></div></div>;
  }

  return (
    <>
      <AppTopbar
        actions={
          <>
            <AvatarSwitcher
              avatars={avatars}
              includeAll={false}
              onChange={(nextAvatarId) => {
                if (nextAvatarId) {
                  window.location.href = `/avatars/${nextAvatarId}`;
                }
              }}
              selectedAvatarId={selectedAvatarId}
            />
            <Link className={buttonVariants({ variant: "outline" })} to={`/library?avatarId=${avatarId}`}>
              Biblioteca
            </Link>
            <Link className={buttonVariants()} to={`/bulk-editor?avatarId=${avatarId}`}>
              Abrir editor
            </Link>
          </>
        }
        crumbs={[
          { label: "Workspace", icon: "home", href: "/" },
          { label: "Avatares", icon: "users", href: "/avatars" },
          { label: avatar?.name ?? "Hub" },
        ]}
      />

      <div className="page">
        {snapshot.error ? (
          <div className="panel empty">
            <div>
              <h3>Falha ao carregar avatar</h3>
              <p>{snapshot.error}</p>
            </div>
          </div>
        ) : null}

        <section className="panel card-pad">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-4">
              <AvatarProfilePhoto avatar={avatar} />
              <div className="col" style={{ gap: 8 }}>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="page-title" style={{ margin: 0 }}>{avatar?.name ?? "Avatar"}</h1>
                  {avatar ? <StatusPill kind="avatar" status={avatar.status} /> : null}
                </div>
                <p className="text-md muted" style={{ maxWidth: 700 }}>
                  {avatar?.persona_summary ?? "Defina a persona editorial e o papel deste avatar no sistema."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Pill tone="violet">formato ativo: react()</Pill>
                  <Pill tone="base">{snapshot.data.sourceVideos.length} base</Pill>
                  <Pill tone="reaction">{snapshot.data.reactionVideos.length} reactions</Pill>
                </div>
              </div>
            </div>
          </div>

          <div className="card card-pad mt-6" style={{ padding: 14 }}>
            <div className="flex items-start gap-3">
              <div className="av-bubble sm" style={{ background: "var(--accent-bg)", color: "var(--accent-hover)" }}>
                <Icon name="arrow-right" size={12} />
              </div>
              <div className="col" style={{ gap: 6 }}>
                <div className="text-md">Proximo passo recomendado</div>
                <div className="text-sm muted">
                  {snapshot.data.sourceVideos.length === 0
                    ? "Abasteça a biblioteca base com clipes antes de abrir o editor."
                    : snapshot.data.reactionVideos.length === 0
                      ? "Suba reactions para habilitar as combinacoes do formato react()."
                      : "O avatar ja tem base e reactions. Abra o editor em massa para gerar jobs."}
                </div>
              </div>
              <div className="ml-auto">
                <Link className={buttonVariants()} to={`/bulk-editor?avatarId=${avatarId}`}>
                  Abrir editor
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className="tabs mt-4">
          {[
            ["overview", "Visao geral"],
            ["biblioteca", "Biblioteca"],
            ["sobre", "Sobre"],
          ].map(([value, label]) => (
            <button
              className={`tab ${tab === value ? "active" : ""}`}
              key={value}
              onClick={() => setTab(value as HubTab)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <div className="mt-4">
            <HubSection
              action={
                <Link className={buttonVariants({ size: "sm", variant: "outline" })} to={`/bulk-editor?avatarId=${avatarId}`}>
                  Abrir editor
                </Link>
              }
              description="Lista dos posts e vídeos que este avatar já gerou ou publicou."
              title="Posts"
            >
              <PostsList jobs={snapshot.data.jobs} />
            </HubSection>
          </div>
        ) : null}

        {tab === "biblioteca" ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <HubSection
              action={<Link className={buttonVariants({ size: "sm", variant: "outline" })} to={`/library?avatarId=${avatarId}`}>Gerenciar</Link>}
              description="Clipes, lances e edits que alimentam este avatar."
              title="Videos base"
            >
              <MediaStrip kind="base" videos={snapshot.data.sourceVideos} />
            </HubSection>
            <HubSection
              action={<Link className={buttonVariants({ size: "sm", variant: "outline" })} to={`/library?avatarId=${avatarId}&kind=reaction`}>Gerenciar</Link>}
              description="Reactions deste avatar para o modulo react()."
              title="Reactions"
            >
              <MediaStrip kind="reaction" videos={snapshot.data.reactionVideos} />
            </HubSection>
          </div>
        ) : null}

        {tab === "sobre" ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <HubSection description="Edite a definicao editorial e operacional do avatar." title="Persona e sobre">
              <form onSubmit={saveAvatar}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="avatar-detail-name">Nome</FieldLabel>
                    <Input
                      id="avatar-detail-name"
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      required
                      value={form.name}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="avatar-detail-photo">Foto do perfil</FieldLabel>
                    <div className="avatar-photo-field">
                      <AvatarProfilePhoto avatar={avatar} previewUrl={photoPreviewUrl} />
                      <div className="col" style={{ gap: 8, minWidth: 0, flex: 1 }}>
                        <Input
                          accept="image/jpeg,image/png,image/webp"
                          id="avatar-detail-photo"
                          onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
                          type="file"
                        />
                        <p className="text-xs muted">
                          JPG, PNG ou WebP. A imagem aparece nos cards de listagem.
                        </p>
                      </div>
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="avatar-detail-summary">Persona resumida</FieldLabel>
                    <Textarea
                      id="avatar-detail-summary"
                      onChange={(event) => setForm((current) => ({ ...current, personaSummary: event.target.value }))}
                      rows={4}
                      value={form.personaSummary}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="avatar-detail-about">Sobre</FieldLabel>
                    <Textarea
                      id="avatar-detail-about"
                      onChange={(event) => setForm((current) => ({ ...current, about: event.target.value }))}
                      rows={8}
                      value={form.about}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="avatar-detail-status">Status</FieldLabel>
                    <Select
                      id="avatar-detail-status"
                      onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as AvatarStatus }))}
                      value={form.status}
                    >
                      <option value="active">Ativo</option>
                      <option value="paused">Pausado</option>
                      <option value="draft">Rascunho</option>
                    </Select>
                  </Field>
                  <div className="flex justify-end">
                    <Button disabled={saving || !form.name.trim()} type="submit">
                      {saving ? "Salvando..." : "Salvar avatar"}
                    </Button>
                  </div>
                </FieldGroup>
              </form>
            </HubSection>

            <HubSection description="Resumo rapido para orientar operacao e criacao." title="Checklist operacional">
              <div className="flex flex-col gap-2">
                {[
                  {
                    ok: snapshot.data.sourceVideos.length > 0,
                    text: "Biblioteca base abastecida",
                  },
                  {
                    ok: snapshot.data.reactionVideos.length > 0,
                    text: "Banco de reactions pronto",
                  },
                ].map((item) => (
                  <div className="card card-pad" key={item.text} style={{ padding: 12 }}>
                    <div className="flex items-center gap-3">
                      <Icon name={item.ok ? "check-circle" : "alert"} style={{ color: item.ok ? "var(--ok)" : "var(--warn)" }} />
                      <span>{item.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </HubSection>
          </div>
        ) : null}
      </div>
    </>
  );
}

function HubSection({
  action,
  children,
  description,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="panel card-pad">
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h2 className="text-lg">{title}</h2>
          <p className="page-subtitle">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyMini({ text }: { text: string }) {
  return (
    <div className="empty" style={{ padding: "32px 12px" }}>
      <div>
        <h3>Nada aqui ainda</h3>
        <p>{text}</p>
      </div>
    </div>
  );
}

function PostsList({ jobs }: { jobs: ReelJob[] }) {
  if (jobs.length === 0) {
    return <EmptyMini text="Nenhum post ou vídeo gerado ainda." />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {jobs.map((job) => (
        <article className="card card-pad" key={job.id}>
          <div className="relative">
            {job.output_path ? (
              <StorageVideoPreview
                aspect="reel"
                bucket="generated-reels"
                path={job.output_path}
                showTitle={false}
                title={job.clip_url}
              />
            ) : (
              <ProcessingPreview status={job.status} />
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill kind="job" status={job.status} />
            <span className="text-xs mono muted">
              {new Date(job.created_at).toLocaleString("pt-BR")}
            </span>
          </div>

          <div className="mt-3 col" style={{ gap: 6, minWidth: 0 }}>
            <span className="truncate text-sm">{job.caption || job.clip_url}</span>
            <span className="truncate text-xs muted">{job.overlay_text}</span>
          </div>

          <div className="mt-4 flex gap-2">
            {job.platform_post_url ? (
              <a
                className={buttonVariants({ className: "flex-1", size: "sm", variant: "outline" })}
                href={job.platform_post_url}
                rel="noreferrer"
                target="_blank"
              >
                Ver post
              </a>
            ) : null}
            {job.output_path ? (
              <span className="flex flex-1 items-center justify-center rounded-md border border-border px-3 text-xs muted">
                Play no card
              </span>
            ) : (
              <span className="flex flex-1 items-center justify-center rounded-md border border-border px-3 text-xs muted">
                Aguardando vídeo
              </span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function ProcessingPreview({ status }: { status: ReelJob["status"] }) {
  const active = status === "processing" || status === "posting";

  return (
    <div className="relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-md border border-border bg-secondary">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(124,108,255,.18), rgba(56,189,248,.08), rgba(0,0,0,.1))",
        }}
      />
      <div className="relative z-10 col items-center text-center" style={{ gap: 10 }}>
        <div
          className="av-bubble lg"
          style={{
            background: active ? "var(--info-bg)" : "var(--surface-3)",
            color: active ? "var(--info)" : "var(--text-muted)",
            borderRadius: 12,
          }}
        >
          <Icon name={active ? "refresh" : "clock"} />
        </div>
        <div className="text-sm">{active ? "Processando" : "Aguardando"}</div>
        <div className="text-xs muted">O preview aparece quando renderizar.</div>
      </div>
      {active ? (
        <div className="progress absolute bottom-0 left-0 right-0 thin">
          <span style={{ width: "70%" }} />
        </div>
      ) : null}
    </div>
  );
}

function MediaStrip({
  kind,
  videos,
}: {
  kind: "base" | "reaction";
  videos: Array<SourceVideo | ReactionVideo>;
}) {
  if (videos.length === 0) {
    return <EmptyMini text={kind === "base" ? "Nenhum video base vinculado." : "Nenhuma reaction vinculada."} />;
  }

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
      {videos.map((video) => (
        <div className="col" key={video.id} style={{ gap: 10 }}>
          <StorageVideoPreview
            aspect="reel"
            bucket={kind === "base" ? "source-videos" : "reaction-videos"}
            path={video.storage_path}
            showTitle={false}
            title={video.name}
          />
          <div className="col" style={{ gap: 4 }}>
            <span className="truncate text-sm">{video.name}</span>
            <span className="text-xs muted">
              {kind === "base" ? "video base" : "reaction"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function AvatarProfilePhoto({
  avatar,
  previewUrl,
}: {
  avatar: Avatar | null | undefined;
  previewUrl?: string | null;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void createAvatarPhotoUrl(avatar?.photo_path)
      .then((url) => {
        if (!cancelled) setPhotoUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPhotoUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [avatar?.photo_path]);

  const source = previewUrl ?? photoUrl;

  if (!source) {
    return <AvatarBubble avatar={avatar} size="xl" />;
  }

  return (
    <div className="avatar-profile-photo" title={avatar?.name ?? "Avatar"}>
      <img alt={avatar ? `Foto de perfil de ${avatar.name}` : "Foto de perfil"} src={source} />
    </div>
  );
}

function buildUniqueAvatarSlug(avatars: Avatar[], name: string) {
  const base = slugifyAvatarName(name);
  const existing = new Set(avatars.map((avatar) => avatar.slug));

  if (!existing.has(base)) return base;

  for (let index = 2; index <= 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }

  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
