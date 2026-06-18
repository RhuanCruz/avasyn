import { ChangeEvent, useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/auth/AuthContext";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import { deleteStorageObject, getStorageUploadUrl } from "@/lib/storage-client";
import type { ReactionVideo } from "@/lib/types";

export function ReactionsPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadReactions = useCallback(async () => {
    const { data, error } = await supabase
      .from("reaction_videos")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as ReactionVideo[];
  }, []);

  const reactions = useSupabaseQuery(loadReactions, []);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    try {
      const { path, uploadUrl } = await getStorageUploadUrl(
        "reaction-videos",
        file.name,
        file.type,
      );
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadResponse.ok) throw new Error("Falha no upload do arquivo");

      const { error } = await supabase.from("reaction_videos").insert({
        user_id: user.id,
        name: file.name,
        storage_path: path,
      });

      if (error) throw error;

      toast.success("Reaction enviada");
      await reactions.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no upload");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function removeReaction(reaction: ReactionVideo) {
    try {
      await deleteStorageObject("reaction-videos", reaction.storage_path);

      const { error } = await supabase
        .from("reaction_videos")
        .delete()
        .eq("id", reaction.id);
      if (error) throw error;

      toast.success("Reaction removida");
      await reactions.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover");
    }
  }

  return (
    <>
      <PageHeader
        action={
          <>
            <Button disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? "Enviando..." : "Enviar reaction"}
            </Button>
            <input
              accept="video/mp4,video/quicktime,video/webm"
              className="sr-only"
              onChange={(event) => void handleFiles(event)}
              ref={fileInputRef}
              type="file"
            />
          </>
        }
        description="Biblioteca privada de vídeos de reação usados na montagem dos Reels."
        title="Reactions"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reactions.data.map((reaction) => (
          <Card key={reaction.id}>
            <CardHeader>
              <CardTitle className="truncate">{reaction.name}</CardTitle>
              <CardDescription>
                Enviado em {new Date(reaction.created_at).toLocaleDateString()}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <StorageVideoPreview
                bucket="reaction-videos"
                path={reaction.storage_path}
                title="Preview"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-xs text-muted-foreground">
                  {reaction.storage_path}
                </span>
                <Button
                  onClick={() => void removeReaction(reaction)}
                  size="sm"
                  variant="outline"
                >
                  Remover
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {reactions.data.length === 0 ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="p-8 text-sm text-muted-foreground">
              Nenhum vídeo de reação enviado.
            </CardContent>
          </Card>
        ) : null}
      </section>
    </>
  );
}
