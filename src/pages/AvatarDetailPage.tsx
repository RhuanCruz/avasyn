import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { PostCalendarTab } from "@/components/post-calendar/PostCalendarTab";
import { AutomacoesTab } from "@/components/automations/AutomacoesTab";
import { TrendsTab } from "@/components/trends/TrendsTab";
import { createAvatarPhotoUrl, removeAvatarPhoto, uploadAvatarPhoto } from "@/lib/avatar-photo";
import { slugifyAvatarName } from "@/lib/avatar-utils";
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type {
  Avatar,
  AvatarStatus,
  PresenterAvatarImage,
  PresenterAvatarProfile,
  PresenterPersona,
  PresenterVideoProject,
  PresenterVoiceOption,
  ReactionVideo,
  ReelJob,
  SocialAccount,
  SourceVideo,
} from "@/lib/types";

type AvatarSnapshot = {
  avatar: Avatar | null;
  sourceVideos: SourceVideo[];
  reactionVideos: ReactionVideo[];
  jobs: ReelJob[];
  activeAccount: SocialAccount | null;
};

type HubTab = "overview" | "videos" | "biblioteca" | "sobre" | "calendario" | "automacoes" | "trends";

export function AvatarDetailPage() {
  const params = useParams<{ avatarId: string }>();
  const avatarId = params.avatarId ?? null;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    avatars,
    refresh: refreshAvatars,
    selectedAvatarId,
    setSelectedAvatarId,
  } = useAvatarState(avatarId);
  const [tab, setTab] = useState<HubTab>(() => {
    const t = searchParams.get("tab");
    if (
      t === "calendario" || t === "overview" || t === "biblioteca" ||
      t === "sobre" || t === "automacoes" || t === "trends" || t === "videos"
    ) {
      return t;
    }
    return "overview";
  });
  // Theme handed off from the Trends tab to pre-fill a new automation.
  const [pendingAutomationTheme, setPendingAutomationTheme] = useState<string | null>(null);
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

  useEffect(() => {
    const connected = searchParams.get("connected"); // platform name or any truthy value
    const accountId = searchParams.get("accountId");
    if (!avatarId || (!connected && !accountId)) return;

    const platform = connected && ["instagram", "youtube"].includes(connected) ? connected : undefined;
    const syncPayload = platform ? { avatarId, platform } : { avatarId };
    const platformLabel = platform === "youtube" ? "YouTube" : platform === "instagram" ? "Instagram" : "Conta";

    invokeFunction<{ count?: number; returnedPlatforms?: string[] }>("zernio-sync-accounts", syncPayload)
      .then((resp) => {
        if ((resp?.count ?? 0) > 0) {
          toast.success(`${platformLabel} sincronizada`);
        } else {
          const onZernio = resp?.returnedPlatforms?.length
            ? ` O Zernio só tem conectado: ${[...new Set(resp.returnedPlatforms)].join(", ")}.`
            : " O Zernio não retornou nenhuma conta.";
          toast.warning(
            `Nenhuma conta ${platformLabel} encontrada no Zernio.${onZernio} A conexão pode não ter concluído — confira no painel do Zernio se o YouTube está habilitado.`,
          );
        }
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Falha ao sincronizar"),
      )
      .finally(() => {
        navigate(`/avatars/${avatarId}?tab=calendario`, { replace: true });
      });
  }, [avatarId, searchParams, navigate]);

  const loadSnapshot = useCallback(async (): Promise<AvatarSnapshot> => {
    if (!avatarId) {
      return {
        avatar: null,
        sourceVideos: [],
        reactionVideos: [],
        jobs: [],
        activeAccount: null,
      };
    }

    const [
      avatarResult,
      sourceVideosResult,
      reactionVideosResult,
      jobsResult,
      accountsResult,
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
      supabase
        .from("social_accounts")
        .select("*")
        .eq("avatar_id", avatarId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    if (avatarResult.error) throw avatarResult.error;
    if (sourceVideosResult.error) throw sourceVideosResult.error;
    if (reactionVideosResult.error) throw reactionVideosResult.error;
    if (jobsResult.error) throw jobsResult.error;

    const accounts = (accountsResult.data ?? []) as SocialAccount[];

    return {
      avatar: (avatarResult.data ?? null) as Avatar | null,
      sourceVideos: (sourceVideosResult.data ?? []) as SourceVideo[],
      reactionVideos: (reactionVideosResult.data ?? []) as ReactionVideo[],
      jobs: (jobsResult.data ?? []) as ReelJob[],
      activeAccount: accounts[0] ?? null,
    };
  }, [avatarId]);

  const snapshot = useSupabaseQuery(loadSnapshot, {
    avatar: null,
    sourceVideos: [],
    reactionVideos: [],
    jobs: [],
    activeAccount: null,
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
            <Link className={buttonVariants({ variant: "outline" })} to={`/bulk-editor?avatarId=${avatarId}`}>
              Abrir editor
            </Link>
            <Link className={buttonVariants()} to={`/avatars/${avatarId}/videos/new`}>
              <Icon name="film" />
              Criar vídeo
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
                  {snapshot.data.activeAccount ? (
                    <Pill tone="ok">
                      <Icon
                        name={snapshot.data.activeAccount.platform ?? "instagram"}
                        size={12}
                        style={{ marginRight: 4 }}
                      />
                      {snapshot.data.activeAccount.username ?? snapshot.data.activeAccount.display_name}
                    </Pill>
                  ) : null}
                </div>
                <p className="text-md muted" style={{ maxWidth: 700 }}>
                  {avatar?.persona_summary ?? "Defina a persona editorial e o papel deste avatar no sistema."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Pill tone="violet">React + vídeos</Pill>
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
            ["videos", "Vídeos"],
            ["biblioteca", "Biblioteca"],
            ["calendario", "Calendário de Posts"],
            ["trends", "Trends"],
            ["automacoes", "Automações"],
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

        {tab === "calendario" && avatarId ? (
          <PostCalendarTab avatarId={avatarId} />
        ) : null}

        {tab === "trends" && avatarId ? (
          <TrendsTab
            avatarId={avatarId}
            onCreateAutomation={(theme) => {
              setPendingAutomationTheme(theme);
              setTab("automacoes");
            }}
          />
        ) : null}

        {tab === "automacoes" && avatarId ? (
          <AutomacoesTab
            avatarId={avatarId}
            initialTheme={pendingAutomationTheme}
            onInitialThemeConsumed={() => setPendingAutomationTheme(null)}
          />
        ) : null}

        {tab === "videos" && avatar ? (
          <VideosTab avatar={avatar} avatarId={avatarId} />
        ) : null}
      </div>
    </>
  );
}

type PresenterSnapshot = {
  images: PresenterAvatarImage[];
  persona: PresenterPersona | null;
  profile: PresenterAvatarProfile | null;
  projects: PresenterVideoProject[];
  voices: PresenterVoiceOption[];
};

type ProjectResponse = { project: PresenterVideoProject };

function VideosTab({
  avatar,
  avatarId,
}: {
  avatar: Avatar;
  avatarId: string;
}) {
  const [topic, setTopic] = useState("");
  const [creatingScript, setCreatingScript] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [reprocessingProjectId, setReprocessingProjectId] = useState<string | null>(null);
  const [syncingProjectId, setSyncingProjectId] = useState<string | null>(null);
  const [deleteConfirmProject, setDeleteConfirmProject] = useState<PresenterVideoProject | null>(null);
  const [reviewProject, setReviewProject] = useState<PresenterVideoProject | null>(null);

  const loadPresenterSnapshot = useCallback(async (): Promise<PresenterSnapshot> => {
    const [profileResult, personaResult, voicesResult, imagesResult, projectsResult] = await Promise.all([
      supabase
        .from("presenter_avatar_profiles")
        .select("*")
        .eq("avatar_id", avatarId)
        .maybeSingle(),
      supabase
        .from("presenter_personas")
        .select("*")
        .eq("avatar_id", avatarId)
        .maybeSingle(),
      supabase
        .from("presenter_voice_options")
        .select("*")
        .eq("avatar_id", avatarId)
        .order("created_at", { ascending: false }),
      supabase
        .from("presenter_avatar_images")
        .select("*")
        .eq("avatar_id", avatarId)
        .order("created_at", { ascending: false }),
      supabase
        .from("presenter_video_projects")
        .select("*")
        .eq("avatar_id", avatarId)
        .order("created_at", { ascending: false }),
    ]);

    if (profileResult.error) throw profileResult.error;
    if (personaResult.error) throw personaResult.error;
    if (voicesResult.error) throw voicesResult.error;
    if (imagesResult.error) throw imagesResult.error;
    if (projectsResult.error) throw projectsResult.error;

    return {
      images: (imagesResult.data ?? []) as PresenterAvatarImage[],
      persona: (personaResult.data ?? null) as PresenterPersona | null,
      profile: (profileResult.data ?? null) as PresenterAvatarProfile | null,
      projects: (projectsResult.data ?? []) as PresenterVideoProject[],
      voices: (voicesResult.data ?? []) as PresenterVoiceOption[],
    };
  }, [avatarId]);

  const presenter = useSupabaseQuery(loadPresenterSnapshot, {
    images: [],
    persona: null,
    profile: null,
    projects: [],
    voices: [],
  });
  const profile = presenter.data.profile;
  const persona = presenter.data.persona;
  const personaSummary = typeof persona?.structured_persona?.summary === "string"
    ? persona.structured_persona.summary
    : avatar.persona_summary ?? "Configure a persona presenter.";
  const selectedVoice =
    presenter.data.voices.find((voice) => voice.voice_id === (profile?.hedra_voice_id ?? profile?.selected_voice_id)) ??
    presenter.data.voices.find((voice) => voice.selected) ??
    null;
  const approvedImage =
    presenter.data.images.find((image) => image.id === profile?.approved_base_image_id) ??
    presenter.data.images.find((image) => image.status === "approved") ??
    null;

  useEffect(() => {
    const channel = supabase
      .channel(`presenter-video-projects-${avatarId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "presenter_video_projects",
        filter: `avatar_id=eq.${avatarId}`,
      }, () => {
        void presenter.refresh();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [avatarId, presenter.refresh]);

  async function generateScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingScript(true);
    try {
      await invokeFunction<ProjectResponse>("generate-presenter-script", {
        avatarId,
        topic,
      });
      setTopic("");
      await presenter.refresh();
      toast.success("Roteiro gerado para revisão");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar roteiro");
    } finally {
      setCreatingScript(false);
    }
  }

  async function approveAndSubmit(project: PresenterVideoProject, scriptText?: string) {
    try {
      const { data, error } = await supabase
        .from("presenter_video_projects")
        .update({
          script_text: scriptText ?? project.script_text,
          status: "ready_for_video",
          updated_at: new Date().toISOString(),
        })
        .eq("id", project.id)
        .select("*")
        .single();
      if (error || !data) throw error ?? new Error("Falha ao aprovar roteiro");

      await invokeFunction<ProjectResponse>("submit-presenter-video", {
        projectId: project.id,
        scriptText: data.script_text,
      });
      await presenter.refresh();
      setReviewProject(null);
      toast.success("Vídeo enviado para Hedra");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar vídeo");
    }
  }

  async function syncProject(project: PresenterVideoProject) {
    setSyncingProjectId(project.id);
    try {
      await invokeFunction<ProjectResponse>("sync-presenter-video", {
        projectId: project.id,
      });
      await presenter.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao sincronizar vídeo");
    } finally {
      setSyncingProjectId(null);
    }
  }

  async function deleteProject(project: PresenterVideoProject) {
    setDeletingProjectId(project.id);
    try {
      await invokeFunction<{ ok: boolean }>("delete-presenter-video-project", {
        projectId: project.id,
      });

      if (reviewProject?.id === project.id) setReviewProject(null);
      setDeleteConfirmProject(null);
      await presenter.refresh();
      toast.success("Projeto excluído");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao excluir projeto");
    } finally {
      setDeletingProjectId(null);
    }
  }

  async function reprocessProject(project: PresenterVideoProject) {
    setReprocessingProjectId(project.id);
    try {
      const { error } = await supabase
        .from("presenter_video_projects")
        .update({
          error_message: null,
          status: "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("id", project.id);
      if (error) throw error;
      await presenter.refresh();

      await invokeFunction<ProjectResponse>("generate-presenter-script", {
        avatarId,
        projectId: project.id,
        topic: project.topic,
      });

      if (reviewProject?.id === project.id) setReviewProject(null);
      await presenter.refresh();
      toast.success("Roteiro reprocessado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao reprocessar roteiro");
    } finally {
      setReprocessingProjectId(null);
    }
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Pill tone={profile?.hedra_image_asset_id ? "ok" : "warn"}>imagem Hedra</Pill>
        <Pill tone={selectedVoice ? "ok" : "warn"}>voz</Pill>
        <Pill tone="base">{presenter.data.projects.length} vídeos</Pill>
        <Link className={buttonVariants({ className: "ml-auto", size: "sm" })} to={`/avatars/${avatarId}/videos/new`}>
          <Icon name="film" />
          Criar vídeo
        </Link>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="flex flex-col gap-4">
            <HubSection description="Estado operacional do avatar presenter." title="Setup">
              <div className="grid gap-3">
                <SetupRow ok={Boolean(persona?.status === "approved")} text="Persona aprovada" />
                <SetupRow ok={Boolean(profile?.hedra_image_asset_id)} text="Imagem base aprovada" />
                <SetupRow ok={Boolean(profile?.hedra_voice_id ?? profile?.selected_voice_id ?? profile?.default_voice_id)} text="Voz definida" />
              </div>
              <Link className={buttonVariants({ className: "mt-4 w-full", variant: "outline" })} to="/avatars/new/presenter">
                Abrir wizard
              </Link>
            </HubSection>

            <HubSection description="Voz selecionada da Hedra para este presenter." title="Voz">
              {selectedVoice ? (
                <div className="card card-pad">
                  <div className="text-md">{selectedVoice.name}</div>
                  <p className="mt-1 text-xs muted">{selectedVoice.language ?? "Idioma não informado"} · {selectedVoice.gender ?? "gênero livre"}</p>
                  {selectedVoice.preview_audio_url ? (
                    <audio className="mt-3 w-full" controls src={selectedVoice.preview_audio_url} />
                  ) : null}
                </div>
              ) : (
                <EmptyMini text="Nenhuma voz selecionada ainda." />
              )}
            </HubSection>
          </div>

          <div className="flex flex-col gap-4">
            <HubSection description="Gere roteiros com pesquisa atual antes de enviar para Hedra." title="Novo vídeo">
              <form onSubmit={generateScript}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="presenter-hub-topic">Tema específico</FieldLabel>
                    <Input
                      id="presenter-hub-topic"
                      onChange={(event) => setTopic(event.target.value)}
                      placeholder="Ex.: notícia, tendência ou tópico do vídeo"
                      required
                      value={topic}
                    />
                  </Field>
                  <Button disabled={creatingScript || !topic.trim()} type="submit">
                    {creatingScript ? "Gerando..." : "Gerar roteiro"}
                  </Button>
                </FieldGroup>
              </form>
            </HubSection>

            <HubSection description="Roteiros, status Hedra e vídeo final." title="Projetos">
              {presenter.data.projects.length === 0 ? (
                <EmptyMini text="Nenhum projeto de vídeo ainda." />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {presenter.data.projects.map((project) => (
                    <PresenterProjectCard
                      key={project.id}
                      deleting={deletingProjectId === project.id}
                      onDelete={setDeleteConfirmProject}
                      onReprocess={(nextProject) => void reprocessProject(nextProject)}
                      onReview={setReviewProject}
                      onSync={syncProject}
                      project={project}
                      reprocessing={reprocessingProjectId === project.id}
                      syncing={syncingProjectId === project.id}
                    />
                  ))}
                </div>
              )}
            </HubSection>
          </div>
        </div>
      {reviewProject ? (
        <PresenterScriptModal
          onClose={() => setReviewProject(null)}
          onSubmit={(project, nextScriptText) => void approveAndSubmit(project, nextScriptText)}
          project={reviewProject}
        />
      ) : null}
      {deleteConfirmProject ? (
        <PresenterDeleteConfirmModal
          deleting={deletingProjectId === deleteConfirmProject.id}
          onClose={() => setDeleteConfirmProject(null)}
          onConfirm={() => void deleteProject(deleteConfirmProject)}
          project={deleteConfirmProject}
        />
      ) : null}
    </>
  );
}

function PresenterProjectCard({
  deleting,
  onDelete,
  onReprocess,
  onReview,
  onSync,
  project,
  reprocessing,
  syncing,
}: {
  deleting: boolean;
  onDelete: (project: PresenterVideoProject) => void;
  onReprocess: (project: PresenterVideoProject) => void;
  onReview: (project: PresenterVideoProject) => void;
  onSync: (project: PresenterVideoProject) => void;
  project: PresenterVideoProject;
  reprocessing: boolean;
  syncing: boolean;
}) {
  const isReview = project.status === "script_pending_review" || project.status === "ready_for_video";
  const isReprocessing = reprocessing || project.status === "draft";
  const isProcessing = project.status === "submitted" || project.status === "processing" || isReprocessing;
  const isDone = project.status === "completed" && project.video_url;
  const canMutateProject = !isProcessing && !deleting;

  return (
    <article className="card card-pad">
      <div className="relative">
        {isDone ? (
          <video
            className="aspect-[9/16] w-full rounded-md border border-border bg-black object-contain"
            controls
            preload="metadata"
            src={project.video_url ?? undefined}
          />
        ) : isReview ? (
          <PresenterScriptPreview />
        ) : (
          <PresenterProcessingPreview reprocessing={isReprocessing} status={project.status} />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PresenterProjectStatusPill status={project.status} />
        <span className="text-xs mono muted">{new Date(project.created_at).toLocaleString("pt-BR")}</span>
      </div>

      <div className="mt-3 col" style={{ gap: 6, minWidth: 0 }}>
        <span className="line-clamp-2 text-sm">{project.topic}</span>
        <span className="line-clamp-2 text-xs muted">
          {isReprocessing ? "Gerando uma nova versão do roteiro..." : project.script_text ?? "Roteiro ainda não disponível."}
        </span>
      </div>

      {project.error_message ? (
        <p className="mt-3 text-sm" style={{ color: "var(--err)" }}>{project.error_message}</p>
      ) : null}

      <div className="mt-4 grid gap-2">
        {isReview ? (
          <Button disabled={!canMutateProject} onClick={() => onReview(project)} size="sm">
            Revisar roteiro
          </Button>
        ) : (
          <Button disabled={deleting} onClick={() => onReview(project)} size="sm" variant="outline">
            Ler roteiro
          </Button>
        )}
        {isReview ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={!canMutateProject}
              onClick={() => onReprocess(project)}
              size="sm"
              variant="outline"
            >
              {reprocessing ? "Reprocessando..." : "Reprocessar"}
            </Button>
            <Button
              disabled={!canMutateProject}
              onClick={() => onDelete(project)}
              size="sm"
              variant="outline"
            >
              {deleting ? "Excluindo..." : "Excluir"}
            </Button>
          </div>
        ) : null}
        {isProcessing || project.hedra_generation_id ? (
          <Button
            disabled={syncing}
            onClick={() => onSync(project)}
            size="sm"
            variant="outline"
          >
            {syncing ? "Sincronizando..." : "Atualizar"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function PresenterProjectStatusPill({ status }: { status: PresenterVideoProject["status"] }) {
  const map: Record<PresenterVideoProject["status"], { label: string; tone: "neutral" | "ok" | "warn" | "err" | "info" | "violet" }> = {
    completed: { label: "Vídeo pronto", tone: "ok" },
    draft: { label: "Rascunho", tone: "neutral" },
    error: { label: "Erro", tone: "err" },
    processing: { label: "Processando", tone: "info" },
    ready_for_video: { label: "Pronto para vídeo", tone: "violet" },
    script_pending_review: { label: "Revisar roteiro", tone: "warn" },
    submitted: { label: "Enviado", tone: "info" },
  };
  const current = map[status];
  return <Pill tone={current.tone} withDot>{current.label}</Pill>;
}

function PresenterScriptPreview() {
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
        <div className="av-bubble lg" style={{ background: "var(--warn-bg)", color: "var(--warn)", borderRadius: 12 }}>
          <Icon name="edit" />
        </div>
        <div className="text-sm">Roteiro para revisar</div>
        <div className="text-xs muted">Abra para ler tudo antes de gerar o vídeo.</div>
      </div>
    </div>
  );
}

function PresenterProcessingPreview({
  reprocessing,
  status,
}: {
  reprocessing?: boolean;
  status: PresenterVideoProject["status"];
}) {
  const waiting = status === "submitted";
  return (
    <div className="relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-md border border-border bg-secondary">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(56,189,248,.14), rgba(124,108,255,.12), rgba(0,0,0,.1))",
        }}
      />
      <div className="relative z-10 col items-center text-center" style={{ gap: 10 }}>
        <div className="av-bubble lg" style={{ background: "var(--info-bg)", color: "var(--info)", borderRadius: 12 }}>
          <Icon name={waiting ? "clock" : "refresh"} />
        </div>
        <div className="text-sm">{reprocessing ? "Reprocessando roteiro" : waiting ? "Enviado para Hedra" : "Processando vídeo"}</div>
        <div className="text-xs muted">{reprocessing ? "O novo roteiro vai aparecer neste card." : "O card atualiza via Supabase Realtime."}</div>
      </div>
      <div className="progress absolute bottom-0 left-0 right-0 thin">
        <span style={{ width: reprocessing ? "55%" : waiting ? "35%" : "70%" }} />
      </div>
    </div>
  );
}

function PresenterScriptModal({
  onClose,
  onSubmit,
  project,
}: {
  onClose: () => void;
  onSubmit: (project: PresenterVideoProject, scriptText: string) => void;
  project: PresenterVideoProject;
}) {
  const [scriptText, setScriptText] = useState(project.script_text ?? "");
  const canSubmit = project.status === "script_pending_review" || project.status === "ready_for_video";
  const scenes = getPresenterScriptScenes(project.script);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="panel"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "100%", maxWidth: 960, maxHeight: "90vh", overflow: "auto", padding: 20 }}
      >
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <PresenterProjectStatusPill status={project.status} />
              <span className="text-lg">{project.topic}</span>
            </div>
            <p className="page-subtitle">Leia e ajuste o roteiro completo antes de enviar para a Hedra.</p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="presenter-script-review">Roteiro completo</FieldLabel>
            <Textarea
              id="presenter-script-review"
              onChange={(event) => setScriptText(event.target.value)}
              readOnly={!canSubmit}
              rows={16}
              value={scriptText}
            />
          </Field>

          {scenes.length > 0 ? (
            <div className="card card-pad">
              <div className="text-md">Estrutura do roteiro</div>
              <div className="mt-3 grid gap-3">
                {scenes.map((scene, index) => (
                  <div className="rounded-md border border-border bg-secondary p-3" key={`${scene.beat}-${index}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone="base">{index + 1}</Pill>
                      <span className="text-sm">{scene.beat}</span>
                    </div>
                    <p className="mt-2 text-sm muted">{scene.narration}</p>
                    {scene.on_screen_text ? (
                      <p className="mt-2 text-xs mono" style={{ color: "var(--info)" }}>
                        {scene.on_screen_text}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {project.research_summary ? (
            <div className="card card-pad">
              <div className="text-md">Pesquisa usada</div>
              <pre className="mt-3 max-h-[220px] overflow-auto rounded-md border border-border bg-secondary p-3 text-xs">
                {JSON.stringify(project.research_summary, null, 2)}
              </pre>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={onClose} variant="outline">Fechar</Button>
            {canSubmit ? (
              <Button disabled={!scriptText.trim()} onClick={() => onSubmit(project, scriptText)}>
                Enviar para Hedra
              </Button>
            ) : null}
          </div>
        </FieldGroup>
      </div>
    </div>
  );
}

function getPresenterScriptScenes(script: Record<string, unknown> | null | undefined) {
  const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
  return scenes
    .map((scene) => {
      if (!scene || typeof scene !== "object") return null;
      const candidate = scene as Record<string, unknown>;
      return {
        beat: typeof candidate.beat === "string" ? candidate.beat : "Cena",
        narration: typeof candidate.narration === "string" ? candidate.narration : "",
        on_screen_text: typeof candidate.on_screen_text === "string" ? candidate.on_screen_text : "",
      };
    })
    .filter((scene): scene is { beat: string; narration: string; on_screen_text: string } =>
      Boolean(scene?.narration.trim())
    );
}

function PresenterDeleteConfirmModal({
  deleting,
  onClose,
  onConfirm,
  project,
}: {
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  project: PresenterVideoProject;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={deleting ? undefined : onClose}
    >
      <div
        className="panel card-pad"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "100%", maxWidth: 420 }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg">Excluir projeto?</h2>
            <p className="mt-2 text-sm muted">
              O roteiro e o status deste projeto serão removidos da lista.
            </p>
          </div>
          <Button disabled={deleting} onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>
        <div className="mt-4 rounded-md border border-border bg-secondary p-3">
          <div className="line-clamp-2 text-sm">{project.topic}</div>
          <div className="mt-2 text-xs muted">{new Date(project.created_at).toLocaleString("pt-BR")}</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button disabled={deleting} onClick={onClose} variant="outline">
            Cancelar
          </Button>
          <Button disabled={deleting} onClick={onConfirm}>
            {deleting ? "Excluindo..." : "Excluir"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SetupRow({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className="card card-pad" style={{ padding: 12 }}>
      <div className="flex items-center gap-3">
        <Icon name={ok ? "check-circle" : "alert"} style={{ color: ok ? "var(--ok)" : "var(--warn)" }} />
        <span>{text}</span>
      </div>
    </div>
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
