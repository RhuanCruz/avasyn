import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { StorageImagePreview, StorageVideoPreview } from "@/components/VideoPreview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase";
import type { MediaImport, SourceVideo } from "@/lib/types";

type AddMode = "menu" | "upload" | "url" | "instagram_profile" | null;

export function LibraryPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [uploading, setUploading] = useState(false);
  const [creatingImport, setCreatingImport] = useState(false);
  const [filter, setFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<SourceVideo | null>(null);

  const loadVideos = useCallback(async () => {
    const { data, error } = await supabase
      .from("source_videos")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as SourceVideo[];
  }, []);

  const loadImports = useCallback(async () => {
    const { data, error } = await supabase
      .from("media_imports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) throw error;
    return (data ?? []) as MediaImport[];
  }, []);

  const videos = useSupabaseQuery(loadVideos, []);
  const imports = useSupabaseQuery(loadImports, []);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`media-library-${user.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "media_imports",
        filter: `user_id=eq.${user.id}`,
      }, () => {
        void imports.refresh();
        void videos.refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [imports.refresh, user, videos.refresh]);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!user || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const storagePath = `${user.id}/${crypto.randomUUID()}-${file.name}`;
        const upload = await supabase.storage
          .from("source-videos")
          .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (upload.error) throw upload.error;
        const { error } = await supabase.from("source_videos").insert({
          user_id: user.id,
          name: file.name,
          storage_path: storagePath,
          source_type: "upload",
        });
        if (error) throw error;
      }
      toast.success(`${files.length} vídeo(s) adicionados`);
      setAddMode(null);
      await videos.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no upload");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function createImport(type: "url" | "instagram_profile", input: string, limit: number) {
    setCreatingImport(true);
    try {
      await invokeFunction("create-media-import", { type, input, limit });
      toast.success("Importação iniciada");
      setAddMode(null);
      await imports.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar importação");
    } finally {
      setCreatingImport(false);
    }
  }

  async function removeSelected() {
    const selected = videos.data.filter((video) => selectedIds.includes(video.id));
    try {
      const videoPaths = selected.map((video) => video.storage_path);
      const thumbnailPaths = selected.flatMap((video) =>
        video.thumbnail_path ? [video.thumbnail_path] : []);
      if (videoPaths.length) {
        const result = await supabase.storage.from("source-videos").remove(videoPaths);
        if (result.error) throw result.error;
      }
      if (thumbnailPaths.length) {
        const result = await supabase.storage.from("source-thumbnails").remove(thumbnailPaths);
        if (result.error) throw result.error;
      }
      const { error } = await supabase.from("source_videos").delete().in("id", selectedIds);
      if (error) throw error;
      setSelectedIds([]);
      toast.success("Mídias removidas");
      await videos.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover mídias");
    }
  }

  const filteredVideos = videos.data.filter((video) =>
    filter === "all" ? true : video.source_type === filter);

  return (
    <>
      <PageHeader
        action={
          <div className="relative">
            <Button onClick={() => setAddMode(addMode ? null : "menu")}>Adicionar mídia</Button>
            {addMode ? (
              <AddMediaPanel
                creating={creatingImport}
                mode={addMode}
                onChoose={setAddMode}
                onClose={() => setAddMode(null)}
                onImport={createImport}
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
        }
        description="Centralize vídeos enviados e importados antes de usá-los nas combinações."
        title="Biblioteca de mídia"
      />

      <ImportProgress imports={imports.data} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select className="sm:w-52" onChange={(event) => setFilter(event.target.value)} value={filter}>
          <option value="all">Todas as origens</option>
          <option value="upload">Arquivos enviados</option>
          <option value="url">Links importados</option>
          <option value="instagram_profile">Perfis Instagram</option>
        </Select>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {filteredVideos.length} mídia(s)
          </span>
          {selectedIds.length > 0 ? (
            <Button onClick={() => void removeSelected()} variant="outline">
              Remover selecionadas ({selectedIds.length})
            </Button>
          ) : null}
        </div>
      </div>

      {filteredVideos.length === 0 ? (
        <Card><CardContent className="p-8 text-sm text-muted-foreground">
          Nenhuma mídia nesta origem.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredVideos.map((video) => {
            const selected = selectedIds.includes(video.id);
            return (
              <article className={cn("flex flex-col gap-3 rounded-md border border-border p-3", selected && "ring-2 ring-ring")} key={video.id}>
                <button className="text-left" onClick={() => setPreview(video)} type="button">
                  <StorageImagePreview path={video.thumbnail_path} title={video.name} />
                </button>
                <p className="truncate text-sm font-medium">{video.name}</p>
                <div className="text-xs text-muted-foreground">
                  <p>{sourceLabel(video.source_type)}</p>
                  {video.source_username ? <p>@{video.source_username}</p> : null}
                </div>
                <Button
                  onClick={() => setSelectedIds((current) =>
                    selected ? current.filter((id) => id !== video.id) : [...current, video.id])}
                  variant={selected ? "default" : "outline"}
                >
                  {selected ? "Selecionada" : "Selecionar"}
                </Button>
              </article>
            );
          })}
        </div>
      )}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)}>
          <div className="w-full max-w-3xl rounded-md bg-card p-4" onClick={(event) => event.stopPropagation()}>
            <StorageVideoPreview bucket="source-videos" path={preview.storage_path} title={preview.name} />
            <Button className="mt-4 w-full" onClick={() => setPreview(null)} variant="outline">Fechar</Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AddMediaPanel({ creating, mode, onChoose, onClose, onImport, onUpload, uploading }: {
  creating: boolean;
  mode: AddMode;
  onChoose: (mode: AddMode) => void;
  onClose: () => void;
  onImport: (type: "url" | "instagram_profile", input: string, limit: number) => Promise<void>;
  onUpload: () => void;
  uploading: boolean;
}) {
  const [input, setInput] = useState("");
  const [limit, setLimit] = useState(10);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "url" || mode === "instagram_profile") void onImport(mode, input, limit);
  }
  return (
    <Card className="absolute right-0 top-12 z-30 w-[min(24rem,calc(100vw-2rem))] shadow-lg">
      <CardHeader>
        <CardTitle>Adicionar mídia</CardTitle>
        <CardDescription>Escolha como o vídeo entrará na biblioteca.</CardDescription>
      </CardHeader>
      <CardContent>
        {mode === "menu" ? (
          <div className="grid gap-2">
            <Button onClick={onUpload} variant="outline">{uploading ? "Enviando..." : "Arquivos do computador"}</Button>
            <Button onClick={() => onChoose("url")} variant="outline">Importar link</Button>
            <Button onClick={() => onChoose("instagram_profile")} variant="outline">Importar perfil Instagram</Button>
            <Button onClick={onClose} variant="ghost">Cancelar</Button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="media-import-input">{mode === "url" ? "Link do vídeo" : "Perfil Instagram"}</FieldLabel>
                <Input id="media-import-input" onChange={(event) => setInput(event.target.value)} placeholder={mode === "url" ? "https://..." : "@perfil"} required value={input} />
              </Field>
              {mode === "instagram_profile" ? (
                <Field>
                  <FieldLabel htmlFor="media-import-limit">Quantidade de Reels</FieldLabel>
                  <Input id="media-import-limit" max={50} min={1} onChange={(event) => setLimit(Number(event.target.value))} type="number" value={limit} />
                  <FieldDescription>Importa os Reels mais recentes, até o limite de 50.</FieldDescription>
                </Field>
              ) : null}
              <Button disabled={creating} type="submit">{creating ? "Iniciando..." : "Importar"}</Button>
              <Button onClick={() => onChoose("menu")} variant="outline">Voltar</Button>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ImportProgress({ imports }: { imports: MediaImport[] }) {
  const visible = imports.filter((item) => item.status !== "completed").slice(0, 4);
  if (visible.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Importações</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {visible.map((item) => {
          const denominator = item.total_items || item.requested_limit;
          const progress = Math.min(100, Math.round((item.processed_items / denominator) * 100));
          return (
            <div className="grid gap-2" key={item.id}>
              <div className="flex justify-between gap-4 text-sm"><span className="truncate">{item.input}</span><span>{item.status}</span></div>
              <div className="h-2 overflow-hidden rounded-sm bg-secondary"><div className="h-full bg-primary" style={{ width: `${progress}%` }} /></div>
              {item.error_message ? <p className="text-xs text-muted-foreground">{item.error_message}</p> : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function sourceLabel(type: SourceVideo["source_type"]) {
  if (type === "instagram_profile") return "Perfil Instagram";
  if (type === "url") return "Link importado";
  return "Arquivo enviado";
}
