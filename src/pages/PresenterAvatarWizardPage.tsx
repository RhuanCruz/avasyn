import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "@/auth/AuthContext";
import { AppTopbar, Icon, Pill } from "@/components/operator-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { notifyAvatarsChanged } from "@/hooks/useAvatarState";
import { invokeFunction } from "@/lib/api";
import { modelLabelWithCost } from "@/lib/hedra-utils";
import { slugifyAvatarName } from "@/lib/avatar-utils";
import { getStorageSignedUrl, getStorageUploadUrl } from "@/lib/storage-client";
import { supabase } from "@/lib/supabase";
import type {
  Avatar,
  HedraModel,
  PresenterAvatarImage,
  PresenterImageSet,
  PresenterAvatarProfile,
  PresenterPersona,
  PresenterVideoProject,
  PresenterVoiceOption,
} from "@/lib/types";

type PersonaResponse = { persona: PresenterPersona };
type ProjectResponse = { project: PresenterVideoProject };
type ModelsResponse = { image: HedraModel[]; video: HedraModel[] };
type ImagePromptResponse = {
  improvedPrompt: string;
  negativePromptGuidance: string;
  styleNotes: string[];
};
type ImageOptionsResponse = {
  imageSet: PresenterImageSet;
  images?: PresenterAvatarImage[];
  pending?: boolean;
};
type UploadImageResponse = {
  image: PresenterAvatarImage;
  imageSet: PresenterImageSet;
  profile: PresenterAvatarProfile;
};
type SelectImageResponse = UploadImageResponse;
type HedraVoiceCatalogOption = {
  gender: string | null;
  language: string | null;
  name: string;
  previewAudioUrl: string | null;
  source: string | null;
  voiceId: string;
};
type SelectVoiceResponse = { profile: PresenterAvatarProfile; voice: PresenterVoiceOption };

export function PresenterAvatarWizardPage() {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [creating, setCreating] = useState(false);
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [profile, setProfile] = useState<PresenterAvatarProfile | null>(null);
  const [persona, setPersona] = useState<PresenterPersona | null>(null);
  const [models, setModels] = useState<ModelsResponse>({ image: [], video: [] });
  const [catalogVoices, setCatalogVoices] = useState<HedraVoiceCatalogOption[]>([]);
  const [voices, setVoices] = useState<PresenterVoiceOption[]>([]);
  const [project, setProject] = useState<PresenterVideoProject | null>(null);
  const [imageSet, setImageSet] = useState<PresenterImageSet | null>(null);
  const [images, setImages] = useState<PresenterAvatarImage[]>([]);
  const [scriptText, setScriptText] = useState("");
  const [identity, setIdentity] = useState({
    name: "",
    mainTopic: "",
  });
  const [rawPersona, setRawPersona] = useState("");
  const [visualDescription, setVisualDescription] = useState("");
  const [improvedPrompt, setImprovedPrompt] = useState("");
  const [imageModelId, setImageModelId] = useState("");
  const [videoModelId, setVideoModelId] = useState("");
  const [videoTopic, setVideoTopic] = useState("");

  const selectedVoiceId = profile?.hedra_voice_id ?? profile?.selected_voice_id ?? profile?.default_voice_id ?? null;
  const canSubmitVideo = Boolean(project?.script_text && profile?.hedra_image_asset_id && selectedVoiceId);
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

  useEffect(() => {
    if (!avatar) return;
    void loadHedraCatalogs();
  }, [avatar]);

  async function loadHedraCatalogs() {
    try {
      const [modelResponse, voiceResponse] = await Promise.all([
        invokeFunction<ModelsResponse>("list-hedra-models"),
        invokeFunction<{ voices: HedraVoiceCatalogOption[] }>("list-hedra-voices"),
      ]);
      setModels(modelResponse);
      setCatalogVoices(voiceResponse.voices);
      const nextImageModelId = profile?.hedra_image_model_id ?? modelResponse.image[0]?.id ?? "";
      const nextVideoModelId = profile?.hedra_video_model_id ?? modelResponse.video[0]?.id ?? "";
      setImageModelId((current) => current || nextImageModelId);
      setVideoModelId((current) => current || nextVideoModelId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar catálogo Hedra");
    }
  }

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
          primary_platform: "hedra",
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

  async function improveVisualPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!avatar) return;
    setCreating(true);
    try {
      const response = await invokeFunction<ImagePromptResponse>("improve-presenter-image-prompt", {
        avatarId: avatar.id,
        rawPrompt: visualDescription,
      });
      setImprovedPrompt(response.improvedPrompt);
      toast.success("Prompt visual melhorado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao melhorar prompt visual");
    } finally {
      setCreating(false);
    }
  }

  async function generateImageOptions() {
    if (!avatar) return;
    const prompt = (improvedPrompt || visualDescription).trim();
    setCreating(true);
    try {
      const response = await invokeFunction<ImageOptionsResponse>("generate-presenter-image-options", {
        avatarId: avatar.id,
        rawPrompt: visualDescription,
        prompt,
        imageModelId,
        count: 3,
      });
      setImageSet(response.imageSet);
      setImages(response.images ?? []);
      toast.success("Geração de imagens enviada para a Hedra");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar imagens");
    } finally {
      setCreating(false);
    }
  }

  async function syncImageOptions() {
    if (!imageSet) return;
    setCreating(true);
    try {
      const response = await invokeFunction<ImageOptionsResponse>("sync-presenter-image-options", {
        imageSetId: imageSet.id,
      });
      setImageSet(response.imageSet);
      setImages(response.images ?? images);
      toast.success(response.pending ? "Imagens ainda processando" : "Opções de imagem sincronizadas");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao sincronizar imagens");
    } finally {
      setCreating(false);
    }
  }

  async function uploadAvatarImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!avatar || !file) return;
    setCreating(true);
    try {
      const { path, uploadUrl } = await getStorageUploadUrl("presenter-avatar-images", file.name, file.type);
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadResponse.ok) throw new Error("Falha no upload da imagem");

      const imageUrl = await getStorageSignedUrl("presenter-avatar-images", path);
      const response = await invokeFunction<UploadImageResponse>("upload-presenter-avatar-image", {
        avatarId: avatar.id,
        storagePath: path,
        imageUrl,
        filename: file.name,
        contentType: file.type,
      });
      setImageSet(response.imageSet);
      setImages([response.image]);
      setProfile(response.profile);
      setStep(4);
      toast.success("Imagem enviada e aprovada como base");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar imagem");
    } finally {
      setCreating(false);
      event.target.value = "";
    }
  }

  async function selectBaseImage(image: PresenterAvatarImage) {
    setCreating(true);
    try {
      const response = await invokeFunction<SelectImageResponse>("select-presenter-base-image", {
        imageId: image.id,
      });
      setImageSet(response.imageSet);
      setImages((current) =>
        current.map((item) => item.id === image.id ? response.image : { ...item, status: "rejected" })
      );
      setProfile(response.profile);
      setStep(4);
      toast.success("Imagem base aprovada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao aprovar imagem");
    } finally {
      setCreating(false);
    }
  }

  async function refreshVoices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    try {
      const response = await invokeFunction<{ voices: HedraVoiceCatalogOption[] }>("list-hedra-voices");
      setCatalogVoices(response.voices);
      toast.success("Vozes Hedra carregadas");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar vozes");
    } finally {
      setCreating(false);
    }
  }

  async function chooseVoice(voice: HedraVoiceCatalogOption) {
    if (!avatar) return;
    setCreating(true);
    try {
      const response = await invokeFunction<SelectVoiceResponse>("select-hedra-presenter-voice", {
        avatarId: avatar.id,
        voiceId: voice.voiceId,
        name: voice.name,
        language: voice.language,
        gender: voice.gender,
        previewAudioUrl: voice.previewAudioUrl,
      });
      setProfile(response.profile);
      setVoices((current) => [
        response.voice,
        ...current.filter((item) => item.id !== response.voice.id),
      ]);
      setStep(5);
      toast.success("Voz selecionada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao selecionar voz");
    } finally {
      setCreating(false);
    }
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
        videoModelId,
      });
      setProject(response.project);
      toast.success("Vídeo enviado para Hedra");
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
          { label: "Novo avatar" },
        ]}
      />

      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Novo avatar</h1>
            <p className="page-subtitle">
            Configure identidade, persona, imagem e voz — depois produza vídeos Talking Head ou reações.
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

        {avatar ? (
          <div className="card card-pad mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-md">Talking Head (multi-cena)</div>
              <p className="text-sm muted">
                Monte um vídeo com várias cenas — falas do avatar e imagens narradas.
              </p>
            </div>
            <Link className={buttonVariants()} to={`/avatars/${avatar.id}/videos/new`}>
              <Icon name="film" />
              Abrir editor
            </Link>
          </div>
        ) : null}

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
          <WizardPanel title="3. Imagem do avatar" description="Gere imagens pela Hedra ou envie uma imagem local para usar como base do presenter.">
            <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
              <form className="card card-pad" onSubmit={improveVisualPrompt}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="visual-description">Gerar com IA</FieldLabel>
                    <Textarea
                      id="visual-description"
                      onChange={(event) => setVisualDescription(event.target.value)}
                      placeholder="Ex.: apresentadora brasileira de futebol, carismática, camisa social azul, estúdio esportivo moderno."
                      rows={5}
                      value={visualDescription}
                    />
                    <FieldDescription>
                      Primeiro melhoramos o prompt; depois você confirma e gera 3 opções.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="image-model">Modelo de imagem</FieldLabel>
                    <Select
                      id="image-model"
                      onChange={(event) => setImageModelId(event.target.value)}
                      value={imageModelId}
                    >
                      <option value="">Selecione um modelo Hedra</option>
                      {models.image.map((model) => (
                        <option key={model.id} value={model.id}>{modelLabelWithCost(model)}</option>
                      ))}
                    </Select>
                  </Field>
                  <Button disabled={creating || !avatar || visualDescription.trim().length < 10} type="submit">
                    {creating ? "Melhorando..." : "Melhorar prompt"}
                  </Button>
                </FieldGroup>
              </form>

              <div className="card card-pad">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="avatar-image-upload">Enviar imagem</FieldLabel>
                    <Input
                      accept="image/jpeg,image/png,image/webp"
                      disabled={creating || !avatar}
                      id="avatar-image-upload"
                      onChange={(event) => void uploadAvatarImage(event)}
                      type="file"
                    />
                    <FieldDescription>
                      JPG, PNG ou WebP. A imagem enviada vira a base aprovada do avatar.
                    </FieldDescription>
                  </Field>
                  {profile?.hedra_image_asset_id ? (
                    <Pill tone="ok">imagem base aprovada</Pill>
                  ) : (
                    <Pill tone="warn">sem imagem aprovada</Pill>
                  )}
                </FieldGroup>
              </div>
            </div>

            {improvedPrompt ? (
              <div className="card card-pad mt-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="improved-prompt">Prompt melhorado</FieldLabel>
                    <Textarea
                      id="improved-prompt"
                      onChange={(event) => setImprovedPrompt(event.target.value)}
                      rows={6}
                      value={improvedPrompt}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={creating || !imageModelId || !improvedPrompt.trim()} onClick={() => void generateImageOptions()} type="button">
                      Gerar 3 opções
                    </Button>
                    {imageSet?.status === "generating_options" ? (
                      <Button disabled={creating} onClick={() => void syncImageOptions()} type="button" variant="outline">
                        <Icon name="refresh" />
                        Sincronizar opções
                      </Button>
                    ) : null}
                  </div>
                </FieldGroup>
              </div>
            ) : null}

            {images.length > 0 ? (
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {images.map((image) => (
                  <article className="card card-pad" key={image.id}>
                    {image.preview_url ? (
                      <img
                        alt="Opção visual do avatar"
                        className="aspect-[9/16] w-full rounded-md border border-border object-cover"
                        src={image.preview_url}
                      />
                    ) : (
                      <div className="empty aspect-[9/16]"><div><h3>Sem preview</h3></div></div>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <Pill tone={image.status === "approved" ? "ok" : image.status === "rejected" ? "base" : "info"}>
                        {image.status}
                      </Pill>
                      <Button
                        disabled={creating || image.status === "approved"}
                        onClick={() => void selectBaseImage(image)}
                        size="sm"
                        type="button"
                      >
                        Usar como base
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </WizardPanel>
        ) : null}

        {step === 4 ? (
          <WizardPanel title="4. Voz" description="Escolha uma voz pública da Hedra para reutilizar nos vídeos deste avatar.">
            <form onSubmit={refreshVoices}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-md">Vozes Hedra</div>
                  <p className="text-sm muted">A voz selecionada fica salva no perfil do presenter.</p>
                </div>
                <Button disabled={creating} type="submit" variant="outline">
                  <Icon name="refresh" />
                  Recarregar vozes
                </Button>
              </div>
            </form>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {catalogVoices.map((voice) => (
                <article className="card card-pad" key={voice.voiceId}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-md truncate">{voice.name}</div>
                    {voice.voiceId === selectedVoiceId ? <Pill tone="ok">selecionada</Pill> : null}
                  </div>
                  <p className="mt-2 text-xs muted">{voice.language ?? "Idioma não informado"} · {voice.gender ?? "gênero livre"}</p>
                  {voice.previewAudioUrl ? (
                    <audio className="mt-3 w-full" controls src={voice.previewAudioUrl} />
                  ) : null}
                  <Button className="mt-4 w-full" disabled={creating} onClick={() => void chooseVoice(voice)} size="sm">
                    Escolher voz
                  </Button>
                </article>
              ))}
            </div>
            {catalogVoices.length === 0 ? (
              <div className="empty mt-4">
                <div>
                  <h3>Nenhuma voz carregada</h3>
                  <p>Recarregue o catálogo Hedra para escolher uma voz.</p>
                </div>
              </div>
            ) : null}
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
          <WizardPanel title="6. Vídeo Hedra" description="Envie o roteiro aprovado para renderização e acompanhe o resultado.">
            <div className="grid gap-4 md:grid-cols-[1fr_0.8fr]">
              <div className="card card-pad">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={project?.status === "completed" ? "ok" : project?.status === "error" ? "err" : "info"}>
                    {project?.status ?? "sem projeto"}
                  </Pill>
                  {profile?.hedra_image_asset_id ? <Pill tone="ok">imagem Hedra pronta</Pill> : null}
                  {selectedVoiceId ? <Pill tone="ok">voz pronta</Pill> : null}
                </div>
                <Field className="mt-4">
                  <FieldLabel htmlFor="video-model">Modelo de vídeo</FieldLabel>
                  <Select
                    id="video-model"
                    onChange={(event) => setVideoModelId(event.target.value)}
                    value={videoModelId}
                  >
                    <option value="">Modelo padrão Hedra Avatar</option>
                    {models.video.map((model) => (
                      <option key={model.id} value={model.id}>
                        {modelLabelWithCost(model)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <p className="mt-3 text-sm muted">Voz: {selectedVoiceId ?? "não selecionada"}</p>
                {project?.error_message ? (
                  <p className="mt-3 text-sm" style={{ color: "var(--err)" }}>{project.error_message}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled={creating || !canSubmitVideo} onClick={() => void submitVideo()}>
                    <Icon name="send" />
                    Enviar para Hedra
                  </Button>
                  <Button disabled={creating || !project?.hedra_generation_id} onClick={() => void syncVideo()} variant="outline">
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
                      <p>Após a Hedra concluir, o preview aparece aqui.</p>
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
