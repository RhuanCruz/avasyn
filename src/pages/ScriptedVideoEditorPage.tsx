import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "@/auth/AuthContext";
import { Icon } from "@/components/operator-ui";
import { invokeFunction } from "@/lib/api";
import { modelLabelWithCost } from "@/lib/hedra-utils";
import { useInView, useSignedUrl } from "@/lib/media-hooks";
import { downloadUrlAsFile, getStorageSignedUrl, getStorageUploadUrl } from "@/lib/storage-client";
import { supabase } from "@/lib/supabase";
import type {
  Avatar,
  CameraMovement,
  HedraModel,
  PresenterAvatarImage,
  PresenterAvatarProfile,
  PresenterVideoProject,
  PresenterVideoScene,
  SceneImageStyle,
  SceneKind,
} from "@/lib/types";

type SceneResponse = { scene: PresenterVideoScene; pending?: boolean };
type VoiceOpt = {
  voiceId: string;
  name: string;
  gender: string | null;
  language: string | null;
  previewAudioUrl: string | null;
};
type ImageTab = "upload" | "biblioteca" | "gerar";
type SidebarTab = "forms" | "chat";

const MOVEMENTS: { key: CameraMovement; label: string }[] = [
  { key: "none", label: "Estático" },
  { key: "zoomin", label: "Aproximar" },
  { key: "zoomout", label: "Afastar" },
  { key: "left", label: "Esquerda" },
  { key: "right", label: "Direita" },
  { key: "up", label: "Cima" },
];

const STYLES: { key: SceneImageStyle; label: string }[] = [
  { key: "realista", label: "Realista" },
  { key: "cine", label: "Cinematográfico" },
  { key: "ilustra", label: "Ilustração" },
  { key: "3d", label: "3D" },
];

const KIND_LABEL: Record<SceneKind, string> = {
  fala: "Fala do avatar",
  imagem: "Imagem + narração",
};

// Omnia (imagem animada) só vai até 8s por geração; fala segue o áudio (até 10min).
const MAX_IMAGE_DURATION = 8;
const WORDS_PER_SECOND = 2.4; // ritmo médio de fala PT-BR

function estimateFalaDuration(text: string | null | undefined) {
  const words = (text ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (!words) return 3;
  return Math.max(1, Math.round(words / WORDS_PER_SECOND));
}

function hueFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}
function gradientFor(id: string) {
  const h = hueFor(id);
  return `radial-gradient(135% 125% at 30% 18%, hsl(${h} 45% 38%), hsl(${h} 38% 22%) 52%, hsl(${h} 30% 12%))`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ScriptedVideoEditorPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { avatarId, projectId } = useParams();

  const [loading, setLoading] = useState(true);
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [profile, setProfile] = useState<PresenterAvatarProfile | null>(null);
  const [project, setProject] = useState<PresenterVideoProject | null>(null);
  const [scenes, setScenes] = useState<PresenterVideoScene[]>([]);
  const [selId, setSelId] = useState<string | null>(null);

  const [imageModels, setImageModels] = useState<HedraModel[]>([]);
  const [videoModels, setVideoModels] = useState<HedraModel[]>([]);
  const [voices, setVoices] = useState<VoiceOpt[]>([]);
  const [imageModelId, setImageModelId] = useState("");
  const [imageTab, setImageTab] = useState<ImageTab>("gerar");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("forms");
  const [libraryOpen, setLibraryOpen] = useState(false);
  // "image" = pick the scene's own image; "reference" = pick a base image to steer I2I generation.
  const [libraryMode, setLibraryMode] = useState<"image" | "reference">("image");
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [uploadingScene, setUploadingScene] = useState(false);
  const [savingBase, setSavingBase] = useState(false);

  const [animating, setAnimating] = useState(false);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sceneId: string } | null>(null);

  const dragRef = useRef<{ id: string; x0: number; d0: number } | null>(null);
  const moveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const upRef = useRef<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoFileRef = useRef<HTMLInputElement | null>(null);
  const reorderFromRef = useRef<number | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [pendingPromptFocus, setPendingPromptFocus] = useState<string | null>(null);

  const sel = scenes.find((s) => s.id === selId) ?? scenes[0] ?? null;
  const total = useMemo(() => scenes.reduce((a, b) => a + b.duration_s, 0), [scenes]);
  const clipsReady = scenes.filter((s) => s.clip_status === "ready").length;
  const allClipsReady = scenes.length > 0 && clipsReady === scenes.length;
  const voiceId = project?.voice_id ?? profile?.hedra_voice_id ?? "";
  const videoModelId = project?.video_model_id ?? profile?.hedra_video_model_id ?? "";
  const motionModelId = project?.motion_model_id ?? "";
  const selVoice = voices.find((v) => v.voiceId === voiceId) ?? null;
  // Lip-sync (fala) models need audio; motion (imagem) models animate a start frame.
  const talkingModels = useMemo(() => videoModels.filter((m) => m.requiresAudioInput), [videoModels]);
  const motionModels = useMemo(() => videoModels.filter((m) => m.requiresStartFrame), [videoModels]);

  // ── Load / bootstrap ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!user || !avatarId) return;
      setLoading(true);
      try {
        const { data: av, error: avErr } = await supabase
          .from("avatars").select("*").eq("id", avatarId).eq("user_id", user.id).single();
        if (avErr || !av) throw avErr ?? new Error("Avatar não encontrado");

        const { data: prof } = await supabase
          .from("presenter_avatar_profiles").select("*")
          .eq("avatar_id", avatarId).eq("user_id", user.id).maybeSingle();

        if (cancelled) return;
        setAvatar(av as Avatar);
        setProfile((prof as PresenterAvatarProfile) ?? null);

        const loaded = await loadOrCreateProject(av as Avatar);
        if (cancelled) return;
        setProject(loaded.project);
        setScenes(loaded.scenes);
        setSelId(loaded.scenes[0]?.id ?? null);
        void resignUserClips(loaded.scenes);
        // Resume tracking any generation still in flight (non-blocking, survives reloads).
        loaded.scenes.forEach((s) => {
          if (s.content_status === "generating") void pollImage(s.id);
          if (s.clip_status === "rendering") void pollClip(s.id);
          if (s.content_status === "ready" && s.image_id && !(s.metadata?.preview_url)) void backfillImage(s.id);
        });
        void loadCatalogs((prof as PresenterAvatarProfile) ?? null);
        if (!projectId && loaded.project) {
          navigate(`/avatars/${avatarId}/videos/${loaded.project.id}`, { replace: true });
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Falha ao abrir editor");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, avatarId, projectId]);

  useEffect(() => () => {
    if (moveRef.current) window.removeEventListener("mousemove", moveRef.current);
    if (upRef.current) window.removeEventListener("mouseup", upRef.current);
  }, []);

  // Reset the image source tab when switching scenes.
  useEffect(() => {
    if (!sel) return;
    setImageTab(sel.image_source === "upload" ? "upload" : sel.image_source === "library" ? "biblioteca" : "gerar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  // Focus the generation prompt once the target scene is selected and the tab renders.
  useEffect(() => {
    if (pendingPromptFocus && pendingPromptFocus === selId && imageTab === "gerar" && promptRef.current) {
      promptRef.current.focus();
      setPendingPromptFocus(null);
    }
  }, [pendingPromptFocus, selId, imageTab]);

  // Empty-card actions: select the scene, switch to the Forms tab, then act.
  function emptyCardAction(sceneId: string, action: "image" | "video" | "library" | "prompt") {
    setSelId(sceneId);
    setSidebarTab("forms");
    if (action === "image") { setImageTab("upload"); requestAnimationFrame(() => fileRef.current?.click()); }
    else if (action === "video") { requestAnimationFrame(() => videoFileRef.current?.click()); }
    else if (action === "library") { setImageTab("biblioteca"); openLibrary("image"); }
    else { setImageTab("gerar"); setPendingPromptFocus(sceneId); }
  }

  async function downloadScene(sceneId: string) {
    const scene = scenes.find((s) => s.id === sceneId);
    if (!scene || scene.clip_status !== "ready") return;
    const index = scenes.findIndex((s) => s.id === sceneId) + 1;
    try {
      let url = scene.clip_url;
      const clipPath = (scene.metadata?.clip_path as string | undefined) ?? null;
      if (clipPath) url = await getStorageSignedUrl("source-videos", clipPath);
      if (!url) throw new Error("Clipe da cena indisponível");
      await downloadUrlAsFile(url, `cena-${index}.mp4`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao baixar a cena");
    }
  }

  async function loadCatalogs(prof: PresenterAvatarProfile | null) {
    try {
      const [models, voiceResp] = await Promise.all([
        invokeFunction<{ image: HedraModel[]; video: HedraModel[] }>("list-hedra-models"),
        invokeFunction<{ voices: VoiceOpt[] }>("list-hedra-voices"),
      ]);
      setImageModels(models.image ?? []);
      setVideoModels(models.video ?? []);
      setVoices(voiceResp.voices ?? []);
      // Prefer a text-to-image model by default — image-to-image (requiresStartFrame)
      // models need a base image and fail without one.
      const defaultImage = prof?.hedra_image_model_id ||
        models.image?.find((m) => !m.requiresStartFrame)?.id ||
        models.image?.[0]?.id || "";
      setImageModelId((cur) => cur || defaultImage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar catálogo Hedra");
    }
  }

  async function loadOrCreateProject(av: Avatar) {
    if (!user) throw new Error("Sessão expirada");
    if (projectId) {
      const { data: proj, error } = await supabase
        .from("presenter_video_projects").select("*")
        .eq("id", projectId).eq("user_id", user.id).single();
      if (error || !proj) throw error ?? new Error("Projeto não encontrado");
      const { data: rows } = await supabase
        .from("presenter_video_scenes").select("*")
        .eq("project_id", projectId).order("position", { ascending: true });
      let list = (rows as PresenterVideoScene[]) ?? [];
      if (list.length === 0) list = [await insertScene(proj.id, av.id, 0)];
      return { project: proj as PresenterVideoProject, scenes: list };
    }
    const { data: proj, error } = await supabase
      .from("presenter_video_projects")
      .insert({ user_id: user.id, avatar_id: av.id, topic: "", format: "roteirizado", status: "draft" })
      .select("*").single();
    if (error || !proj) throw error ?? new Error("Falha ao criar projeto");
    const first = await insertScene(proj.id, av.id, 0);
    return { project: proj as PresenterVideoProject, scenes: [first] };
  }

  async function insertScene(pid: string, avId: string, position: number, kind: SceneKind = "fala") {
    if (!user) throw new Error("Sessão expirada");
    const { data, error } = await supabase
      .from("presenter_video_scenes")
      .insert({
        user_id: user.id, avatar_id: avId, project_id: pid,
        position, kind, content_status: "empty", duration_s: kind === "fala" ? 12 : 6,
      })
      .select("*").single();
    if (error || !data) throw error ?? new Error("Falha ao criar cena");
    return data as PresenterVideoScene;
  }

  // ── Project + scene mutations ─────────────────────────────────────
  async function persistProject(patch: Partial<PresenterVideoProject>) {
    if (!project) return;
    setProject({ ...project, ...patch });
    const { error } = await supabase
      .from("presenter_video_projects")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", project.id);
    if (error) toast.error(error.message);
  }

  const patchSceneLocal = useCallback((id: string, patch: Partial<PresenterVideoScene>) => {
    setScenes((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  async function persistScene(id: string, patch: Partial<PresenterVideoScene>) {
    patchSceneLocal(id, patch);
    const { error } = await supabase
      .from("presenter_video_scenes")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
  }

  async function addScene() {
    if (!project || !avatar) return;
    try {
      const next = await insertScene(project.id, avatar.id, scenes.length, "fala");
      setScenes((cur) => [...cur, next]);
      setSelId(next.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao adicionar cena");
    }
  }

  async function deleteScene(id: string) {
    if (scenes.length <= 1) return;
    const remaining = scenes.filter((s) => s.id !== id);
    setScenes(remaining);
    if (selId === id) setSelId(remaining[0]?.id ?? null);
    const { error } = await supabase.from("presenter_video_scenes").delete().eq("id", id);
    if (error) toast.error(error.message);
  }

  function setKind(id: string, kind: SceneKind) {
    const scene = scenes.find((s) => s.id === id);
    const duration_s = kind === "imagem"
      ? Math.min(scene?.duration_s ?? 6, MAX_IMAGE_DURATION)
      : estimateFalaDuration(scene?.text);
    void persistScene(id, { kind, duration_s });
  }

  async function reorderScenes(from: number, to: number) {
    if (from === to) return;
    const next = [...scenes];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    const repositioned = next.map((s, idx) => ({ ...s, position: idx }));
    setScenes(repositioned);
    await Promise.all(
      repositioned.map((s, idx) =>
        supabase.from("presenter_video_scenes").update({ position: idx }).eq("id", s.id)
      ),
    );
  }
  function swapKind(id: string) {
    const scene = scenes.find((s) => s.id === id);
    if (!scene) return;
    setKind(id, scene.kind === "fala" ? "imagem" : "fala");
  }

  function startDrag(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const scene = scenes.find((s) => s.id === id);
    if (!scene || scene.kind === "fala") return; // fala segue o áudio; sem resize manual
    dragRef.current = { id, x0: e.clientX, d0: scene.duration_s };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const nd = Math.max(1, Math.min(MAX_IMAGE_DURATION, Math.round(d.d0 + (ev.clientX - d.x0) / 16)));
      patchSceneLocal(d.id, { duration_s: nd });
    };
    const onUp = () => {
      const d = dragRef.current;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      moveRef.current = null;
      upRef.current = null;
      if (d) {
        const cur = scenes.find((s) => s.id === d.id);
        const latest = cur ? cur.duration_s : d.d0;
        void supabase.from("presenter_video_scenes").update({ duration_s: latest }).eq("id", d.id);
      }
      dragRef.current = null;
    };
    moveRef.current = onMove;
    upRef.current = onUp;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ── Image sources ─────────────────────────────────────────────────
  async function generateImage(id: string) {
    const scene = scenes.find((s) => s.id === id);
    if (!scene || !(scene.prompt ?? "").trim()) {
      toast.error("Escreva um prompt para a imagem");
      return;
    }
    if (!imageModelId) {
      toast.error("Escolha um modelo de imagem");
      return;
    }
    patchSceneLocal(id, { content_status: "generating" });
    try {
      const referenceImageId = (scene.metadata?.reference_asset_id as string | undefined) ?? undefined;
      const res = await invokeFunction<SceneResponse>("generate-scene-image", { sceneId: id, imageModelId, referenceImageId });
      patchSceneLocal(id, res.scene);
      if (res.pending) void pollImage(id);
      else if (res.scene.content_status === "error") toast.error(res.scene.error_message ?? "Falha ao gerar imagem");
      else toast.success("Imagem gerada");
    } catch (error) {
      patchSceneLocal(id, { content_status: "error" });
      toast.error(error instanceof Error ? error.message : "Falha ao gerar imagem");
    }
  }

  async function enhanceImage(id: string) {
    const scene = scenes.find((s) => s.id === id);
    if (!scene?.hedra_image_asset_id) {
      toast.error("Gere ou envie a imagem da cena primeiro");
      return;
    }
    patchSceneLocal(id, { content_status: "generating" });
    try {
      const res = await invokeFunction<SceneResponse>("upscale-scene-image", { sceneId: id, imageModelId });
      patchSceneLocal(id, res.scene);
      if (res.pending) void pollImage(id);
      else toast.success("Imagem melhorada");
    } catch (error) {
      patchSceneLocal(id, { content_status: "ready" });
      toast.error(error instanceof Error ? error.message : "Falha ao melhorar imagem");
    }
  }

  async function saveAsBaseImage(scene: PresenterVideoScene) {
    if (!scene.image_id) {
      toast.error("Gere ou envie a imagem da cena primeiro");
      return;
    }
    setSavingBase(true);
    try {
      await invokeFunction("set-avatar-base-image", { imageId: scene.image_id });
      toast.success("Imagem salva como foto base do avatar");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar como foto base");
    } finally {
      setSavingBase(false);
    }
  }

  // Backfill the preview URL for already-ready scenes whose URL wasn't captured.
  async function backfillImage(id: string) {
    try {
      const res = await invokeFunction<SceneResponse>("sync-scene-image", { sceneId: id });
      patchSceneLocal(id, res.scene);
    } catch {
      // ignore
    }
  }

  async function pollImage(id: string, attempt = 0) {
    if (attempt > 40) return;
    await sleep(3000);
    try {
      const res = await invokeFunction<SceneResponse>("sync-scene-image", { sceneId: id });
      patchSceneLocal(id, res.scene);
      if (res.pending) void pollImage(id, attempt + 1);
      else if (res.scene.content_status === "error") toast.error(res.scene.error_message ?? "Falha ao gerar imagem");
      else toast.success("Imagem gerada");
    } catch {
      void pollImage(id, attempt + 1);
    }
  }

  async function onUploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !sel) return;
    setUploadingScene(true);
    try {
      const { path, uploadUrl } = await getStorageUploadUrl("presenter-avatar-images", file.name, file.type);
      const up = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!up.ok) throw new Error("Falha no upload da imagem");
      const imageUrl = await getStorageSignedUrl("presenter-avatar-images", path);
      const res = await invokeFunction<SceneResponse>("upload-scene-image", {
        sceneId: sel.id, storagePath: path, imageUrl, filename: file.name, contentType: file.type,
      });
      patchSceneLocal(sel.id, res.scene);
      toast.success("Imagem enviada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar imagem");
    } finally {
      setUploadingScene(false);
    }
  }

  async function onUploadVideo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !sel) return;
    setUploadingScene(true);
    try {
      const { path, uploadUrl } = await getStorageUploadUrl("source-videos", file.name, file.type);
      const up = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!up.ok) throw new Error("Falha no upload do vídeo");
      const clipUrl = await getStorageSignedUrl("source-videos", path);
      await persistScene(sel.id, {
        clip_url: clipUrl,
        clip_status: "ready",
        content_status: "ready",
        error_message: null,
        metadata: { ...(sel.metadata ?? {}), user_clip: true, clip_path: path },
      });
      toast.success("Vídeo enviado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar vídeo");
    } finally {
      setUploadingScene(false);
    }
  }

  // User-uploaded clips are stored as signed URLs that expire; re-sign on load.
  async function resignUserClips(list: PresenterVideoScene[]) {
    for (const s of list) {
      const clipPath = (s.metadata?.clip_path as string | undefined) ?? null;
      if (!clipPath) continue;
      try {
        const url = await getStorageSignedUrl("source-videos", clipPath);
        patchSceneLocal(s.id, { clip_url: url });
      } catch {
        // keep the stored URL if re-signing fails
      }
    }
  }

  function pickLibraryImage(image: PresenterAvatarImage) {
    if (!sel) return;
    if (!image.provider_asset_id) {
      toast.error("Esta imagem não tem asset Hedra");
      return;
    }
    if (libraryMode === "reference") {
      // Base/reference image to steer image-to-image generation for this scene.
      void persistScene(sel.id, {
        metadata: {
          ...(sel.metadata ?? {}),
          reference_asset_id: image.provider_asset_id,
          reference_preview_url: image.preview_url,
        },
      });
      setLibraryOpen(false);
      return;
    }
    void persistScene(sel.id, {
      image_id: image.id,
      image_source: "library",
      hedra_image_asset_id: image.provider_asset_id,
      content_status: "ready",
      metadata: { ...(sel.metadata ?? {}), preview_url: image.preview_url },
    });
    setLibraryOpen(false);
  }

  function openLibrary(mode: "image" | "reference") {
    setLibraryMode(mode);
    setLibraryOpen(true);
  }

  function clearReference() {
    if (!sel) return;
    const meta = { ...(sel.metadata ?? {}) };
    delete meta.reference_asset_id;
    delete meta.reference_preview_url;
    void persistScene(sel.id, { metadata: meta });
  }

  // ── Clip render ───────────────────────────────────────────────────
  async function renderClip(id: string) {
    patchSceneLocal(id, { clip_status: "rendering" });
    try {
      const res = await invokeFunction<SceneResponse>("render-scene-clip", { sceneId: id });
      patchSceneLocal(id, res.scene);
      if (res.pending) void pollClip(id);
    } catch (error) {
      patchSceneLocal(id, { clip_status: "error" });
      toast.error(error instanceof Error ? error.message : "Falha ao gerar vídeo da cena");
    }
  }

  async function pollClip(id: string, attempt = 0) {
    if (attempt > 60) return;
    await sleep(4000);
    try {
      const res = await invokeFunction<SceneResponse>("sync-scene-clip", { sceneId: id });
      patchSceneLocal(id, res.scene);
      if (res.pending) void pollClip(id, attempt + 1);
      else if (res.scene.clip_status === "ready") toast.success("Vídeo da cena pronto");
    } catch {
      void pollClip(id, attempt + 1);
    }
  }

  function sceneReady(s: PresenterVideoScene) {
    if (s.clip_status === "ready") return true; // clipe pronto (gerado ou enviado pelo usuário)
    const text = s.kind === "fala" ? s.text : s.narration;
    return Boolean(s.hedra_image_asset_id) && Boolean((text ?? "").trim());
  }

  function animate() {
    if (!voiceId) {
      toast.error("Escolha a voz do vídeo antes de animar");
      return;
    }
    if (!scenes.every(sceneReady)) {
      toast.error("Complete todas as cenas (imagem + texto) antes de animar");
      return;
    }
    setAnimating(true);
    scenes.forEach((s) => {
      if (s.clip_status !== "ready" && s.clip_status !== "rendering") void renderClip(s.id);
    });
    if (project) void persistProject({ total_duration_s: total });
  }

  if (loading) {
    return (
      <div className="sv-root">
        <div className="empty" style={{ margin: "auto" }}>
          <div><h3>Carregando editor</h3><p>Preparando cenas do vídeo.</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="sv-root">
      <input accept="image/jpeg,image/png,image/webp" hidden onChange={onUploadFile} ref={fileRef} type="file" />
      <input accept="video/mp4,video/quicktime,video/webm" hidden onChange={onUploadVideo} ref={videoFileRef} type="file" />

      {/* Header */}
      <header className="sv-header">
        <div className="sv-crumbs">
          <Link to="/avatars">Avatares</Link>
          <span className="sep">/</span>
          <Link to={`/avatars/${avatarId}`}>{avatar?.name ?? "Avatar"}</Link>
          <span className="sep">/</span>
          <span className="current">Novo vídeo</span>
        </div>
        <div className="sv-format-toggle">
          <button className="active" type="button">Talking Head</button>
          <button onClick={() => navigate(`/bulk-editor?avatarId=${avatarId}`)} type="button">React</button>
        </div>
        <div className="sv-header-right">
          <span className="muted text-sm">Total {total}s</span>
          <button className="sv-btn-primary" onClick={animate} type="button">
            <Icon name="play" size={15} /> Animar vídeo
          </button>
        </div>
      </header>

      <div className="sv-body">
        {/* Main: scenes + timeline */}
        <div className="sv-main">
          <div className="sv-section-head">
            <div className="text-lg" style={{ fontWeight: 600 }}>Cenas</div>
            <div className="muted text-sm">
              Cada cena é uma fala do avatar ou uma imagem com narração. Arraste os cards para reordenar; clique com o botão direito para deletar.
            </div>
          </div>

          <div className="sv-scene-strip">
            {scenes.map((scene, i) => {
              const generating = scene.content_status === "generating";
              const preview = scene.metadata?.preview_url as string | undefined;
              const isEmpty = scene.content_status !== "ready" && !preview && !generating;
              const selected = scene.id === sel?.id;
              return (
                <div
                  className={`sv-scene-card${selected ? " selected" : ""}${isEmpty ? " empty" : ""}`}
                  draggable
                  key={scene.id}
                  onClick={() => setSelId(scene.id)}
                  onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, sceneId: scene.id }); }}
                  onDragStart={() => { reorderFromRef.current = i; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { const from = reorderFromRef.current; reorderFromRef.current = null; if (from != null) void reorderScenes(from, i); }}
                  role="button"
                >
                  {generating ? (
                    <div className="sv-scene-generating">
                      <span className="sv-spinner" />
                      <span className="text-sm">Gerando…</span>
                    </div>
                  ) : isEmpty ? (
                    <div className="sv-scene-empty">
                      <button className="sv-chip" onClick={(e) => { e.stopPropagation(); emptyCardAction(scene.id, "image"); }} type="button">Imagem</button>
                      <button className="sv-chip" onClick={(e) => { e.stopPropagation(); emptyCardAction(scene.id, "video"); }} type="button">Vídeo</button>
                      <button className="sv-chip" onClick={(e) => { e.stopPropagation(); emptyCardAction(scene.id, "library"); }} type="button">Biblioteca</button>
                      <button className="sv-chip" onClick={(e) => { e.stopPropagation(); emptyCardAction(scene.id, "prompt"); }} type="button">Prompt</button>
                    </div>
                  ) : (
                    <>
                      {scene.clip_status === "ready" && scene.clip_url ? (
                        <video
                          className="sv-scene-img"
                          controls
                          onClick={(e) => e.stopPropagation()}
                          playsInline
                          poster={scene.clip_thumbnail_url ?? undefined}
                          preload="metadata"
                          // Seek to a frame so a poster shows instead of a black box.
                          src={`${scene.clip_url}#t=0.1`}
                        />
                      ) : preview ? (
                        <img alt="" className="sv-scene-img" src={preview} />
                      ) : (
                        <div className="sv-scene-bg" style={{ background: gradientFor(scene.id) }} />
                      )}
                      <div className="sv-scene-tools">
                        <span className="sv-scene-tool" onClick={(e) => { e.stopPropagation(); swapKind(scene.id); }}>
                          <Icon name="refresh" size={13} />
                        </span>
                        {scenes.length > 1 ? (
                          <span className="sv-scene-tool danger" onClick={(e) => { e.stopPropagation(); void deleteScene(scene.id); }}>
                            <Icon name="trash" size={13} />
                          </span>
                        ) : null}
                      </div>
                    </>
                  )}
                  {scene.clip_status === "ready" && scene.clip_url ? null : (
                    <span className="sv-scene-label">Cena {i + 1} · {scene.duration_s}s</span>
                  )}
                </div>
              );
            })}
            <div className="sv-add-wrap">
              <button className="sv-add-btn" onClick={() => void addScene()} type="button" aria-label="Adicionar cena">
                <Icon name="plus" size={20} />
              </button>
            </div>
          </div>

          <div className="sv-timeline">
            <div className="sv-timeline-head">
              <span style={{ fontWeight: 600 }}>Linha do tempo</span>
              <span className="muted text-sm">Arraste a borda direita de cada faixa para esticar a duração</span>
            </div>
            <div className="sv-timeline-tracks">
              {scenes.map((scene) => {
                const selected = scene.id === sel?.id;
                return (
                  <div
                    className={`sv-track${selected ? " selected" : ""}`}
                    key={scene.id}
                    onClick={() => setSelId(scene.id)}
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, sceneId: scene.id }); }}
                    style={{ width: `${scene.duration_s * 16}px` }}
                  >
                    <span className="sv-track-dur">{scene.duration_s}s</span>
                    {scene.kind === "imagem" ? (
                      <span className="sv-track-handle" onMouseDown={(e) => startDrag(scene.id, e)}>
                        <span />
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Inspector */}
        <aside className="sv-inspector">
          {sel ? (
            <>
              <div className="sv-inspector-head">
                <div className="text-md" style={{ fontWeight: 700 }}>
                  Cena {scenes.findIndex((s) => s.id === sel.id) + 1}
                </div>
                <div className="muted text-sm">{KIND_LABEL[sel.kind]} · {sel.duration_s}s</div>
              </div>

              <div className="sv-inspector-tabs">
                <button className={`sv-inspector-tab${sidebarTab === "forms" ? " active" : ""}`} onClick={() => setSidebarTab("forms")} type="button">Forms</button>
                <button className={`sv-inspector-tab${sidebarTab === "chat" ? " active" : ""}`} onClick={() => setSidebarTab("chat")} type="button">Chat</button>
              </div>

              {sidebarTab === "chat" ? (
                <div className="sv-inspector-body">
                  <div className="sv-chat-soon">
                    <Icon name="reaction" size={22} />
                    <div className="text-md" style={{ fontWeight: 700, marginTop: 8 }}>Modo agente (em breve)</div>
                    <p className="muted text-sm" style={{ marginTop: 6 }}>
                      Em breve você poderá gerar e editar cenas conversando com um agente que conhece a persona
                      do avatar, as imagens base e os roteiros salvos. Use "@" para fixar uma cena ou roteiro no contexto.
                    </p>
                  </div>
                </div>
              ) : (
              <div className="sv-inspector-body">
                <div className="sv-field">
                  <div className="sv-field-label">Voz do vídeo</div>
                  <button className="sv-select sv-voice-trigger sv-full" onClick={() => setVoicePickerOpen(true)} type="button">
                    <span>{selVoice ? `${selVoice.name}${selVoice.language ? ` · ${selVoice.language}` : ""}` : "Selecionar voz"}</span>
                    <Icon name="chevron-down" size={14} />
                  </button>
                </div>

                <div className="sv-field">
                  <div className="sv-field-label">Tipo de conteúdo</div>
                  <div className="sv-type-row">
                    <button className={`sv-seg${sel.kind === "fala" ? " active" : ""}`} onClick={() => setKind(sel.id, "fala")} type="button">
                      <Icon name="users" size={15} /> Fala
                    </button>
                    <button className={`sv-seg${sel.kind === "imagem" ? " active" : ""}`} onClick={() => setKind(sel.id, "imagem")} type="button">
                      <Icon name="image" size={15} /> Imagem + narração
                    </button>
                  </div>
                </div>

                {/* Image */}
                <div className="sv-field">
                  <div className="sv-field-label">Imagem da cena</div>
                  {sel.image_id ? (
                    <button
                      className="sv-btn-ghost sv-full"
                      disabled={sel.content_status === "generating"}
                      onClick={() => void enhanceImage(sel.id)}
                      style={{ marginBottom: 10 }}
                      type="button"
                    >
                      <Icon name="wand" size={15} />
                      {sel.content_status === "generating" ? "Melhorando…" : "Melhorar com IA (upscale)"}
                    </button>
                  ) : null}
                  {sel.image_id ? (
                    <button
                      className="sv-btn-ghost sv-full"
                      disabled={savingBase}
                      onClick={() => void saveAsBaseImage(sel)}
                      style={{ marginBottom: 10 }}
                      type="button"
                    >
                      <Icon name="check" size={15} />
                      {savingBase ? "Salvando…" : "Salvar como foto base do avatar"}
                    </button>
                  ) : null}
                  <div className="sv-img-tabs">
                    {(["upload", "biblioteca", "gerar"] as ImageTab[]).map((t) => (
                      <button
                        className={`sv-img-tab${imageTab === t ? " active" : ""}`}
                        key={t}
                        onClick={() => setImageTab(t)}
                        type="button"
                      >
                        {t === "upload" ? "Upload" : t === "biblioteca" ? "Biblioteca" : "Gerar"}
                      </button>
                    ))}
                  </div>

                  {imageTab === "upload" ? (
                    <button className="sv-btn-ghost sv-full" disabled={uploadingScene} onClick={() => fileRef.current?.click()} type="button">
                      <Icon name="upload" size={15} />
                      {uploadingScene ? "Enviando…" : "Enviar imagem"}
                    </button>
                  ) : null}

                  {imageTab === "biblioteca" ? (
                    <button className="sv-btn-ghost sv-full" onClick={() => openLibrary("image")} type="button">
                      <Icon name="library" size={15} /> Escolher da biblioteca
                    </button>
                  ) : null}

                  {imageTab === "gerar" ? (
                    <>
                      <textarea
                        className="sv-textarea"
                        defaultValue={sel.prompt ?? ""}
                        key={`prompt-${sel.id}`}
                        onBlur={(e) => void persistScene(sel.id, { prompt: e.target.value })}
                        placeholder={sel.kind === "fala" ? "Descreva o avatar nesta cena…" : "Descreva a imagem desta cena…"}
                        ref={promptRef}
                        rows={3}
                      />
                      <select className="sv-select sv-full" onChange={(e) => setImageModelId(e.target.value)} value={imageModelId}>
                        <option value="">Modelo de imagem</option>
                        {imageModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {modelLabelWithCost(m)}{m.requiresStartFrame ? " · precisa de imagem base" : ""}
                          </option>
                        ))}
                      </select>

                      {(() => {
                        const refPreview = sel.metadata?.reference_preview_url as string | undefined;
                        const modelNeedsBase = imageModels.find((m) => m.id === imageModelId)?.requiresStartFrame;
                        return (
                          <div className="sv-ref" style={{ marginTop: 8 }}>
                            <div className="sv-field-label" style={{ marginBottom: 6 }}>
                              Imagem base (referência){modelNeedsBase ? " — obrigatória neste modelo" : ""}
                            </div>
                            {refPreview ? (
                              <div className="sv-ref-row">
                                <img alt="" className="sv-ref-thumb" src={refPreview} />
                                <button className="sv-btn-ghost" onClick={() => openLibrary("reference")} type="button">Trocar</button>
                                <button className="sv-btn-ghost" onClick={clearReference} type="button">Remover</button>
                              </div>
                            ) : (
                              <button className="sv-btn-ghost sv-full" onClick={() => openLibrary("reference")} type="button">
                                <Icon name="library" size={15} /> Escolher imagem base
                              </button>
                            )}
                            <p className="text-xs muted" style={{ marginTop: 4 }}>
                              Usada por modelos image-to-image (I2I) para manter rosto/estilo. Escolha da biblioteca do avatar.
                            </p>
                          </div>
                        );
                      })()}
                      {sel.kind === "imagem" ? (
                        <div className="sv-style-row" style={{ marginTop: 8 }}>
                          {STYLES.map((st) => (
                            <button
                              className={`sv-style${sel.image_style === st.key ? " active" : ""}`}
                              key={st.key}
                              onClick={() => void persistScene(sel.id, { image_style: st.key })}
                              type="button"
                            >
                              {st.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <button
                        className="sv-btn-primary sv-full"
                        disabled={sel.content_status === "generating"}
                        onClick={() => void generateImage(sel.id)}
                        type="button"
                      >
                        <Icon name="wand" size={15} />
                        {sel.content_status === "generating" ? "Gerando…" : "Gerar imagem"}
                      </button>
                    </>
                  ) : null}
                </div>

                <div className="sv-field">
                  <div className="sv-field-label">Movimento de câmera</div>
                  <div className="sv-move-grid">
                    {MOVEMENTS.map((m) => (
                      <button
                        className={`sv-move${sel.camera_movement === m.key ? " active" : ""}`}
                        key={m.key}
                        onClick={() => void persistScene(sel.id, { camera_movement: m.key })}
                        type="button"
                      >
                        <span className="text-xs" style={{ fontWeight: 600 }}>{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="sv-field">
                  <div className="sv-field-label">Ação / câmera (prompt livre)</div>
                  <textarea
                    className="sv-textarea"
                    defaultValue={sel.action_prompt ?? ""}
                    key={`action-${sel.id}`}
                    onBlur={(e) => void persistScene(sel.id, { action_prompt: e.target.value })}
                    placeholder={sel.kind === "fala"
                      ? "Ex: gesticula com as mãos, olha para a câmera, fundo de escritório, plano médio…"
                      : "Ex: câmera aproxima devagar, folhas balançam, luz do fim de tarde…"}
                    rows={3}
                  />
                  <p className="text-xs muted">Direção livre da ação da pessoa, enquadramento e câmera. Combina com o preset acima.</p>
                </div>

                <div className="sv-field">
                  <div className="sv-field-row">
                    <span className="sv-field-label">Duração</span>
                    <span className="sv-dur-value">{sel.duration_s}s</span>
                  </div>
                  {sel.kind === "fala" ? (
                    <p className="text-xs muted">Calculada automaticamente pela fala — o vídeo acompanha o áudio.</p>
                  ) : (
                    <>
                      <input
                        className="sv-range"
                        max={MAX_IMAGE_DURATION}
                        min={1}
                        onChange={(e) => patchSceneLocal(sel.id, { duration_s: Number(e.target.value) })}
                        onMouseUp={() => void persistScene(sel.id, { duration_s: sel.duration_s })}
                        type="range"
                        value={sel.duration_s}
                      />
                      <p className="text-xs muted">Máx {MAX_IMAGE_DURATION}s (limite do modelo de imagem animada).</p>
                    </>
                  )}
                </div>

                <div className="sv-field">
                  <div className="sv-field-label">{sel.kind === "fala" ? "Fala do avatar" : "Narração"}</div>
                  {sel.kind === "fala" ? (
                    <textarea
                      className="sv-textarea"
                      defaultValue={sel.text ?? ""}
                      key={`fala-${sel.id}`}
                      onBlur={(e) => void persistScene(sel.id, { text: e.target.value, duration_s: estimateFalaDuration(e.target.value) })}
                      placeholder="Escreva o que o avatar deve falar nesta cena…"
                      rows={4}
                    />
                  ) : (
                    <textarea
                      className="sv-textarea"
                      defaultValue={sel.narration ?? ""}
                      key={`narr-${sel.id}`}
                      onBlur={(e) => void persistScene(sel.id, { narration: e.target.value })}
                      placeholder="Texto narrado sobre a imagem…"
                      rows={4}
                    />
                  )}
                  <div className="sv-voice-row">
                    <Icon name="reaction" size={15} />
                    Voz: {selVoice?.name ?? "não selecionada"}
                  </div>
                </div>

                {/* Clip */}
                <div className="sv-field">
                  <div className="sv-field-label">Vídeo da cena</div>
                  {sel.clip_status === "ready" ? (
                    <p className="text-xs muted" style={{ marginBottom: 8 }}>Pronto — toca no card da cena.</p>
                  ) : null}
                  <select
                    className="sv-select sv-full"
                    onChange={(e) => void persistProject(sel.kind === "fala" ? { video_model_id: e.target.value } : { motion_model_id: e.target.value })}
                    style={{ marginBottom: 8 }}
                    value={sel.kind === "fala" ? videoModelId : motionModelId}
                  >
                    <option value="">{sel.kind === "fala" ? "Modelo de fala (lip-sync)" : "Modelo de movimento"}</option>
                    {(sel.kind === "fala" ? talkingModels : motionModels).map((m) => (
                      <option key={m.id} value={m.id}>{modelLabelWithCost(m)}</option>
                    ))}
                  </select>
                  <button
                    className="sv-btn-primary sv-full"
                    disabled={!sel.hedra_image_asset_id || (sel.kind === "fala" && !voiceId) || sel.clip_status === "rendering"}
                    onClick={() => void renderClip(sel.id)}
                    type="button"
                  >
                    <Icon name={sel.clip_status === "rendering" ? "refresh" : "film"} size={15} />
                    {sel.clip_status === "rendering"
                      ? "Renderizando…"
                      : sel.clip_status === "ready" ? "Regerar vídeo" : "Gerar vídeo da cena"}
                  </button>
                  <button
                    className="sv-btn-ghost sv-full"
                    disabled={uploadingScene}
                    onClick={() => videoFileRef.current?.click()}
                    style={{ marginTop: 8 }}
                    type="button"
                  >
                    <Icon name="upload" size={15} />
                    {uploadingScene ? "Enviando…" : "Enviar vídeo pronto"}
                  </button>
                  {sel.clip_status === "error" && sel.error_message ? (
                    <p className="text-xs" style={{ color: "var(--err)", marginTop: 6 }}>{sel.error_message}</p>
                  ) : null}
                </div>
              </div>
              )}
            </>
          ) : null}
        </aside>
      </div>

      {libraryOpen && avatarId ? (
        <LibraryImagePicker avatarId={avatarId} onClose={() => setLibraryOpen(false)} onPick={pickLibraryImage} />
      ) : null}

      {voicePickerOpen ? (
        <VoicePicker
          onClose={() => setVoicePickerOpen(false)}
          onSelect={(v) => { void persistProject({ voice_id: v.voiceId }); setVoicePickerOpen(false); }}
          selectedId={voiceId}
          voices={voices}
        />
      ) : null}

      {ctxMenu ? (
        <>
          <div
            className="sv-ctx-backdrop"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div className="sv-ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }}>
            <button
              className="sv-ctx-item"
              disabled={scenes.find((s) => s.id === ctxMenu.sceneId)?.clip_status !== "ready"}
              onClick={() => { void downloadScene(ctxMenu.sceneId); setCtxMenu(null); }}
              type="button"
            >
              <Icon name="download" size={13} /> Baixar cena
            </button>
            <button
              className="sv-ctx-item danger"
              disabled={scenes.length <= 1}
              onClick={() => { void deleteScene(ctxMenu.sceneId); setCtxMenu(null); }}
              type="button"
            >
              <Icon name="trash" size={13} /> Deletar cena
            </button>
          </div>
        </>
      ) : null}

      {animating ? (
        <div className="sv-modal-overlay" onClick={allClipsReady ? () => setAnimating(false) : undefined}>
          <div className="sv-modal" onClick={(e) => e.stopPropagation()}>
            {!allClipsReady ? (
              <>
                <div className="sv-modal-head">
                  <span className="sv-spinner lg" />
                  <div style={{ flex: 1 }}>
                    <div className="text-lg" style={{ fontWeight: 700 }}>Renderizando cenas</div>
                    <div className="muted text-sm">{clipsReady} de {scenes.length} clipes prontos · {total}s</div>
                  </div>
                  <span className="sv-anim-pct">{Math.round((clipsReady / scenes.length) * 100)}%</span>
                </div>
                <div className="sv-progress"><span style={{ width: `${(clipsReady / scenes.length) * 100}%` }} /></div>
                <p className="muted text-xs" style={{ marginTop: 12 }}>
                  Cada cena vira um clipe na Hedra. A junção num vídeo único é o próximo passo.
                </p>
              </>
            ) : (
              <>
                <div className="sv-done-badge"><Icon name="check" size={14} /> {scenes.length} clipes prontos</div>
                <div className="sv-clip-grid">
                  {scenes.map((s) => (
                    s.clip_url ? <video className="sv-clip-thumb" key={s.id} muted preload="metadata" src={s.clip_url} /> : null
                  ))}
                </div>
                <p className="muted text-xs" style={{ margin: "10px 0 14px" }}>
                  Os clipes estão prontos. A concatenação num vídeo único 9:16 é a próxima fase.
                </p>
                <div className="sv-modal-actions">
                  <button className="sv-btn-ghost sv-full" onClick={() => setAnimating(false)} type="button">Voltar a editar</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VoicePicker({
  voices,
  selectedId,
  onSelect,
  onClose,
}: {
  voices: VoiceOpt[];
  selectedId: string;
  onSelect: (voice: VoiceOpt) => void;
  onClose: () => void;
}) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const sorted = useMemo(() => {
    const score = (v: VoiceOpt) => {
      const lang = (v.language ?? "").toLowerCase();
      let s = 0;
      if (lang.includes("pt") || lang.includes("portug")) s -= 4; // idioma alvo primeiro
      if (v.previewAudioUrl) s -= 1; // depois as que têm prévia
      return s;
    };
    return [...voices].sort((a, b) => score(a) - score(b));
  }, [voices]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  function togglePreview(v: VoiceOpt) {
    const audio = audioRef.current;
    if (!audio || !v.previewAudioUrl) return;
    if (playingId === v.voiceId) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.src = v.previewAudioUrl;
    void audio.play().then(() => setPlayingId(v.voiceId)).catch(() => setPlayingId(null));
  }

  return (
    <div className="sv-modal-overlay" onClick={onClose}>
      <div className="sv-modal" onClick={(e) => e.stopPropagation()} style={{ width: 480, maxHeight: "82vh", overflow: "auto" }}>
        <div className="page-header" style={{ marginBottom: 14 }}>
          <div>
            <div className="text-lg" style={{ fontWeight: 700 }}>Escolher voz</div>
            <p className="page-subtitle">Ouça a prévia (no idioma da voz). A fala final é gerada em Português.</p>
          </div>
          <button className="sv-btn-ghost" onClick={onClose} type="button"><Icon name="x" size={15} /></button>
        </div>
        <audio hidden onEnded={() => setPlayingId(null)} ref={audioRef} />
        <div className="sv-voice-list">
          {sorted.map((v) => (
            <div className={`sv-voice-item${v.voiceId === selectedId ? " selected" : ""}`} key={v.voiceId}>
              <button
                className="sv-voice-play"
                disabled={!v.previewAudioUrl}
                onClick={() => togglePreview(v)}
                title={v.previewAudioUrl ? "Ouvir prévia" : "Sem prévia"}
                type="button"
              >
                <Icon name={playingId === v.voiceId ? "pause" : "play"} size={13} />
              </button>
              <div className="sv-voice-meta">
                <div className="sv-voice-name">{v.name}</div>
                <div className="sv-voice-lang">
                  {v.language ?? "idioma n/d"}{v.gender ? ` · ${v.gender}` : ""}{v.previewAudioUrl ? "" : " · sem prévia"}
                </div>
              </div>
              <button className="sv-btn-ghost" onClick={() => onSelect(v)} type="button">
                {v.voiceId === selectedId ? "Selecionada" : "Usar"}
              </button>
            </div>
          ))}
          {sorted.length === 0 ? (
            <div className="empty"><div><h3>Nenhuma voz</h3><p>Catálogo Hedra vazio.</p></div></div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LibraryImagePicker({
  avatarId,
  onClose,
  onPick,
}: {
  avatarId: string;
  onClose: () => void;
  onPick: (image: PresenterAvatarImage) => void;
}) {
  const [images, setImages] = useState<PresenterAvatarImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    const { data } = await supabase
      .from("presenter_avatar_images")
      .select("*")
      .eq("avatar_id", avatarId)
      .not("provider_asset_id", "is", null)
      .order("created_at", { ascending: false });
    setImages((data as PresenterAvatarImage[]) ?? []);
    setLoading(false);
  }, [avatarId]);

  useEffect(() => { void reload(); }, [reload]);

  async function onUploadImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    let ok = 0;
    for (const file of files) {
      try {
        const { path, uploadUrl } = await getStorageUploadUrl("presenter-avatar-images", file.name, file.type);
        const up = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        if (!up.ok) throw new Error("Falha no upload");
        const imageUrl = await getStorageSignedUrl("presenter-avatar-images", path);
        await invokeFunction("upload-presenter-avatar-image", {
          avatarId, storagePath: path, imageUrl, filename: file.name, contentType: file.type, setAsBase: false,
        });
        ok += 1;
      } catch (error) {
        toast.error(`${file.name}: ${error instanceof Error ? error.message : "falha no upload"}`);
      }
    }
    setUploading(false);
    if (ok > 0) { toast.success(`${ok} imagem(ns) enviada(s)`); void reload(); }
  }

  return (
    <div className="sv-modal-overlay" onClick={onClose}>
      <div className="sv-modal" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxHeight: "82vh", overflow: "auto" }}>
        <input accept="image/jpeg,image/png,image/webp" hidden multiple onChange={onUploadImages} ref={uploadRef} type="file" />
        <div className="page-header" style={{ marginBottom: 14 }}>
          <div>
            <div className="text-lg" style={{ fontWeight: 700 }}>Biblioteca do avatar</div>
            <p className="page-subtitle">Imagens já geradas/enviadas para este avatar.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="sv-btn-ghost" disabled={uploading} onClick={() => uploadRef.current?.click()} type="button">
              <Icon name="upload" size={15} /> {uploading ? "Enviando…" : "Enviar imagens"}
            </button>
            <button className="sv-btn-ghost" onClick={onClose} type="button"><Icon name="x" size={15} /></button>
          </div>
        </div>
        {loading ? (
          <div className="empty"><div><h3>Carregando…</h3></div></div>
        ) : images.length === 0 ? (
          <div className="empty">
            <div>
              <h3>Sem imagens ainda</h3>
              <p>Gere uma imagem ou envie as suas.</p>
              <button className="sv-btn-ghost" disabled={uploading} onClick={() => uploadRef.current?.click()} style={{ marginTop: 12 }} type="button">
                <Icon name="upload" size={15} /> {uploading ? "Enviando…" : "Enviar imagens"}
              </button>
            </div>
          </div>
        ) : (
          <div className="sv-lib-grid">
            {images.map((img) => (
              <LibraryImageThumb image={img} key={img.id} onPick={onPick} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Lazy-loads each thumbnail: only signs/fetches once near the viewport, prefers a
// freshly re-signed URL from the storage path (preview_url expires ~2h), and falls
// back to the stored preview_url.
function LibraryImageThumb({
  image,
  onPick,
}: {
  image: PresenterAvatarImage;
  onPick: (image: PresenterAvatarImage) => void;
}) {
  const { ref, inView } = useInView<HTMLButtonElement>("200px");
  const signed = useSignedUrl("presenter-avatar-images", image.storage_path, inView && Boolean(image.storage_path));
  const src = signed ?? (inView ? image.preview_url : null);
  return (
    <button className="sv-lib-item" onClick={() => onPick(image)} ref={ref} type="button">
      {src
        ? <img alt="" decoding="async" loading="lazy" src={src} />
        : <div className="sv-lib-empty"><Icon name="image" size={20} /></div>}
    </button>
  );
}
