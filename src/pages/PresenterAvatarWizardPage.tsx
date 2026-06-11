import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "@/auth/AuthContext";
import { AppTopbar, Icon, Pill } from "@/components/operator-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { notifyAvatarsChanged } from "@/hooks/useAvatarState";
import { invokeFunction } from "@/lib/api";
import { slugifyAvatarName } from "@/lib/avatar-utils";
import { supabase } from "@/lib/supabase";
import type {
  Avatar,
  PresenterAvatarProfile,
  PresenterPersona,
  PresenterVideoProject,
  PresenterVoiceOption,
} from "@/lib/types";

type PersonaResponse = { persona: PresenterPersona };
type ProfileResponse = { profile: PresenterAvatarProfile };
type VoicesResponse = { voices: PresenterVoiceOption[] };
type ProjectResponse = { project: PresenterVideoProject };

export function PresenterAvatarWizardPage() {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [creating, setCreating] = useState(false);
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [profile, setProfile] = useState<PresenterAvatarProfile | null>(null);
  const [persona, setPersona] = useState<PresenterPersona | null>(null);
  const [voices, setVoices] = useState<PresenterVoiceOption[]>([]);
  const [project, setProject] = useState<PresenterVideoProject | null>(null);
  const [scriptText, setScriptText] = useState("");
  const [identity, setIdentity] = useState({
    name: "",
    mainTopic: "",
  });
  const [rawPersona, setRawPersona] = useState("");
  const [visualDescription, setVisualDescription] = useState("");
  const [voiceBrief, setVoiceBrief] = useState("");
  const [videoTopic, setVideoTopic] = useState("");

  const selectedVoiceId = profile?.selected_voice_id ?? profile?.default_voice_id ?? null;
  const canSubmitVideo = Boolean(project?.script_text && profile?.heygen_avatar_id);
  const progress = useMemo(
    () => [
      { id: 1, label: "Identidade" },
      { id: 2, label: "Persona" },
      { id: 3, label: "Visual" },
      { id: 4, label: "Voz" },
      { id: 5, label: "Roteiro" },
      { id: 6, label: "Vídeo" },
    ],
    [],
  );

  async function createIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setCreating(true);
    try {
      const slug = `${slugifyAvatarName(identity.name)}-${crypto.randomUUID().slice(0, 6)}`;
      const { data: avatarData, error: avatarError } = await supabase
        .from("avatars")
        .insert({
          user_id: user.id,
          name: identity.name.trim(),
          slug,
          status: "draft",
          avatar_kind: "presenter",
          primary_platform: "heygen",
          persona_summary: `Presenter sobre ${identity.mainTopic.trim()}`,
        })
        .select("*")
        .single();
      if (avatarError || !avatarData) throw avatarError ?? new Error("Falha ao criar avatar");

      const { data: profileData, error: profileError } = await supabase
        .from("presenter_avatar_profiles")
        .insert({
          user_id: user.id,
          avatar_id: avatarData.id,
          main_topic: identity.mainTopic.trim(),
        })
        .select("*")
        .single();
      if (profileError || !profileData) throw profileError ?? new Error("Falha ao criar perfil presenter");

      setAvatar(avatarData as Avatar);
      setProfile(profileData as PresenterAvatarProfile);
      notifyAvatarsChanged();
      setStep(2);
      toast.success("Identidade criada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar presenter");
    } finally {
      setCreating(false);
    }
  }

  async function generatePersona(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!avatar) return;
    setCreating(true);
    try {
      const response = await invokeFunction<PersonaResponse>("structure-presenter-persona", {
        avatarId: avatar.id,
        rawPersona,
      });
      setPersona(response.persona);
      toast.success("Persona estruturada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao estruturar persona");
    } finally {
      setCreating(false);
    }
  }

  async function approvePersona() {
    if (!persona) return;
    const { data, error } = await supabase
      .from("presenter_personas")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", persona.id)
      .select("*")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Falha ao aprovar persona");
      return;
    }
    setPersona(data as PresenterPersona);
    setStep(3);
  }

  async function createHeyGenAvatar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!avatar) return;
    setCreating(true);
    try {
      const response = await invokeFunction<ProfileResponse>("create-heygen-presenter-avatar", {
        avatarId: avatar.id,
        visualDescription,
      });
      setProfile(response.profile);
      setStep(4);
      toast.success("Avatar HeyGen criado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar avatar HeyGen");
    } finally {
      setCreating(false);
    }
  }

  async function designVoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!avatar) return;
    setCreating(true);
    try {
      const response = await invokeFunction<VoicesResponse>("design-heygen-voice", {
        avatarId: avatar.id,
        voiceBrief,
      });
      setVoices(response.voices);
      toast.success("Opções de voz geradas");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar vozes");
    } finally {
      setCreating(false);
    }
  }

  async function chooseVoice(voice: PresenterVoiceOption) {
    if (!profile) return;
    const { data, error } = await supabase
      .from("presenter_avatar_profiles")
      .update({ selected_voice_id: voice.voice_id, updated_at: new Date().toISOString() })
      .eq("id", profile.id)
      .select("*")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Falha ao selecionar voz");
      return;
    }
    await supabase
      .from("presenter_voice_options")
      .update({ selected: false })
      .eq("avatar_id", profile.avatar_id);
    await supabase
      .from("presenter_voice_options")
      .update({ selected: true })
      .eq("id", voice.id);
    setProfile(data as PresenterAvatarProfile);
    setVoices((current) => current.map((item) => ({ ...item, selected: item.id === voice.id })));
    setStep(5);
  }

  async function generateScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!avatar) return;
    setCreating(true);
    try {
      const response = await invokeFunction<ProjectResponse>("generate-presenter-script", {
        avatarId: avatar.id,
        topic: videoTopic,
      });
      setProject(response.project);
      setScriptText(response.project.script_text ?? "");
      toast.success("Roteiro gerado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar roteiro");
    } finally {
      setCreating(false);
    }
  }

  async function approveScript() {
    if (!project) return;
    const { data, error } = await supabase
      .from("presenter_video_projects")
      .update({
        script_text: scriptText,
        status: "ready_for_video",
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .select("*")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Falha ao aprovar roteiro");
      return;
    }
    setProject(data as PresenterVideoProject);
    setStep(6);
  }

  async function submitVideo() {
    if (!project) return;
    setCreating(true);
    try {
      const response = await invokeFunction<ProjectResponse>("submit-presenter-video", {
        projectId: project.id,
        scriptText,
      });
      setProject(response.project);
      toast.success("Vídeo enviado para HeyGen");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar vídeo");
    } finally {
      setCreating(false);
    }
  }

  async function syncVideo() {
    if (!project) return;
    setCreating(true);
    try {
      const response = await invokeFunction<ProjectResponse>("sync-presenter-video", {
        projectId: project.id,
      });
      setProject(response.project);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao sincronizar vídeo");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <AppTopbar
        actions={<Link className={buttonVariants({ variant: "outline" })} to="/avatars">Avatares</Link>}
        crumbs={[
          { label: "Workspace", icon: "home", href: "/" },
          { label: "Avatares", icon: "users", href: "/avatars" },
          { label: "Presenter" },
        ]}
      />

      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Novo avatar presenter</h1>
            <p className="page-subtitle">
              Crie identidade, persona, visual, voz, roteiro e vídeo final pela HeyGen.
            </p>
          </div>
          {avatar ? (
            <Link className={buttonVariants({ variant: "outline" })} to={`/avatars/${avatar.id}`}>
              Abrir hub
            </Link>
          ) : null}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {progress.map((item) => (
            <button
              className={`tab ${step === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => setStep(item.id)}
              type="button"
            >
              {item.id}. {item.label}
            </button>
          ))}
        </div>

        {step === 1 ? (
          <WizardPanel title="1. Identidade" description="Nome e tema principal orientam persona, visual, voz e roteiros.">
            <form onSubmit={createIdentity}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="presenter-name">Nome</FieldLabel>
                  <Input
                    id="presenter-name"
                    onChange={(event) => setIdentity((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Ex.: Nina Finanças"
                    required
                    value={identity.name}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="presenter-topic">Tema principal</FieldLabel>
                  <Input
                    id="presenter-topic"
                    onChange={(event) => setIdentity((current) => ({ ...current, mainTopic: event.target.value }))}
                    placeholder="Ex.: finanças pessoais"
                    required
                    value={identity.mainTopic}
                  />
                </Field>
                <Button disabled={creating || !identity.name.trim() || !identity.mainTopic.trim()} type="submit">
                  {creating ? "Criando..." : "Criar identidade"}
                </Button>
              </FieldGroup>
            </form>
          </WizardPanel>
        ) : null}

        {step === 2 ? (
          <WizardPanel title="2. Persona" description="Escreva livremente; o backend estrutura a ficha para roteiro.">
            <form onSubmit={generatePersona}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="presenter-persona">Persona bruta</FieldLabel>
                  <Textarea
                    id="presenter-persona"
                    onChange={(event) => setRawPersona(event.target.value)}
                    placeholder="Voz, jeito de falar, crenças, bordões, o que ama e evita..."
                    required
                    rows={8}
                    value={rawPersona}
                  />
                </Field>
                <Button disabled={creating || !avatar || rawPersona.trim().length < 20} type="submit">
                  {creating ? "Estruturando..." : "Gerar ficha de persona"}
                </Button>
              </FieldGroup>
            </form>
            {persona ? (
              <ReviewBlock
                action={<Button onClick={() => void approvePersona()}>Aprovar persona</Button>}
                title="Ficha gerada"
                value={persona.structured_persona}
              />
            ) : null}
          </WizardPanel>
        ) : null}

        {step === 3 ? (
          <WizardPanel title="3. Visual HeyGen" description="A HeyGen cria a identidade visual persistente do avatar.">
            <form onSubmit={createHeyGenAvatar}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="visual-description">Direção visual</FieldLabel>
                  <Textarea
                    id="visual-description"
                    onChange={(event) => setVisualDescription(event.target.value)}
                    placeholder="Aparência, idade percebida, estilo, roupa, cenário, energia visual."
                    rows={5}
                    value={visualDescription}
                  />
                  <FieldDescription>
                    Opcional. Se vazio, usamos nome, tema e persona para montar o prompt.
                  </FieldDescription>
                </Field>
                <Button disabled={creating || !avatar} type="submit">
                  {creating ? "Criando na HeyGen..." : "Criar avatar HeyGen"}
                </Button>
              </FieldGroup>
            </form>
            {profile?.heygen_preview_image_url ? (
              <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
                <img
                  alt="Preview HeyGen"
                  className="aspect-square w-full rounded-md border border-border object-cover"
                  src={profile.heygen_preview_image_url}
                />
                <div className="card card-pad">
                  <div className="text-md">Avatar HeyGen pronto</div>
                  <p className="mt-2 text-sm muted">Look: {profile.heygen_avatar_id}</p>
                  <p className="text-sm muted">Grupo: {profile.heygen_avatar_group_id}</p>
                </div>
              </div>
            ) : null}
          </WizardPanel>
        ) : null}

        {step === 4 ? (
          <WizardPanel title="4. Voz" description="A voz fica na HeyGen e será reutilizada nos vídeos do avatar.">
            <form onSubmit={designVoice}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="voice-brief">Direção de voz</FieldLabel>
                  <Textarea
                    id="voice-brief"
                    onChange={(event) => setVoiceBrief(event.target.value)}
                    placeholder="Ex.: voz brasileira confiante, jovem adulta, ritmo rápido e didático."
                    rows={4}
                    value={voiceBrief}
                  />
                </Field>
                <Button disabled={creating || !avatar} type="submit">
                  {creating ? "Gerando vozes..." : "Gerar opções de voz"}
                </Button>
              </FieldGroup>
            </form>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {voices.map((voice) => (
                <article className="card card-pad" key={voice.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-md truncate">{voice.name}</div>
                    {voice.voice_id === selectedVoiceId ? <Pill tone="ok">selecionada</Pill> : null}
                  </div>
                  <p className="mt-2 text-xs muted">{voice.language ?? "Idioma não informado"} · {voice.gender ?? "gênero livre"}</p>
                  {voice.preview_audio_url ? (
                    <audio className="mt-3 w-full" controls src={voice.preview_audio_url} />
                  ) : null}
                  <Button className="mt-4 w-full" onClick={() => void chooseVoice(voice)} size="sm">
                    Escolher voz
                  </Button>
                </article>
              ))}
            </div>
          </WizardPanel>
        ) : null}

        {step === 5 ? (
          <WizardPanel title="5. Roteiro" description="O agente pesquisa o tema atual e escreve um roteiro para revisão.">
            <form onSubmit={generateScript}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="video-topic">Tema específico do vídeo</FieldLabel>
                  <Input
                    id="video-topic"
                    onChange={(event) => setVideoTopic(event.target.value)}
                    placeholder="Ex.: como organizar salário recém recebido"
                    required
                    value={videoTopic}
                  />
                </Field>
                <Button disabled={creating || !avatar || !videoTopic.trim()} type="submit">
                  {creating ? "Pesquisando e escrevendo..." : "Gerar roteiro"}
                </Button>
              </FieldGroup>
            </form>
            {project ? (
              <div className="mt-4">
                <ReviewBlock title="Pesquisa" value={project.research_summary} />
                <Field className="mt-4">
                  <FieldLabel htmlFor="script-text">Roteiro aprovado para fala</FieldLabel>
                  <Textarea
                    id="script-text"
                    onChange={(event) => setScriptText(event.target.value)}
                    rows={10}
                    value={scriptText}
                  />
                </Field>
                <div className="mt-4 flex justify-end">
                  <Button onClick={() => void approveScript()}>Aprovar roteiro</Button>
                </div>
              </div>
            ) : null}
          </WizardPanel>
        ) : null}

        {step === 6 ? (
          <WizardPanel title="6. Vídeo HeyGen" description="Envie o roteiro aprovado para renderização e acompanhe o resultado.">
            <div className="grid gap-4 md:grid-cols-[1fr_0.8fr]">
              <div className="card card-pad">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={project?.status === "completed" ? "ok" : project?.status === "error" ? "err" : "info"}>
                    {project?.status ?? "sem projeto"}
                  </Pill>
                  {profile?.heygen_avatar_id ? <Pill tone="violet">HeyGen avatar pronto</Pill> : null}
                </div>
                <p className="mt-3 text-sm muted">
                  Voz: {selectedVoiceId ?? "voz padrão do avatar HeyGen"}
                </p>
                {project?.error_message ? (
                  <p className="mt-3 text-sm" style={{ color: "var(--err)" }}>{project.error_message}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled={creating || !canSubmitVideo} onClick={() => void submitVideo()}>
                    <Icon name="send" />
                    Enviar para HeyGen
                  </Button>
                  <Button disabled={creating || !project?.heygen_video_id} onClick={() => void syncVideo()} variant="outline">
                    <Icon name="refresh" />
                    Sincronizar
                  </Button>
                </div>
              </div>
              <div>
                {project?.video_url ? (
                  <video
                    className="aspect-[9/16] w-full rounded-md border border-border bg-black object-contain"
                    controls
                    src={project.video_url}
                  />
                ) : (
                  <div className="empty" style={{ minHeight: 320 }}>
                    <div>
                      <h3>Vídeo ainda não disponível</h3>
                      <p>Após a HeyGen concluir, o preview aparece aqui.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </WizardPanel>
        ) : null}
      </div>
    </>
  );
}

function WizardPanel({
  children,
  description,
  title,
}: {
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
      </div>
      {children}
    </section>
  );
}

function ReviewBlock({
  action,
  title,
  value,
}: {
  action?: React.ReactNode;
  title: string;
  value: unknown;
}) {
  return (
    <div className="card card-pad mt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-md">{title}</div>
        {action}
      </div>
      <pre className="mt-4 max-h-[360px] overflow-auto rounded-md border border-border bg-secondary p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
