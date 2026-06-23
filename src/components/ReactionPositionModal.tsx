import { type PointerEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getStorageSignedUrl } from "@/lib/storage-client";
import { supabase } from "@/lib/supabase";
import type { ReactionVideo } from "@/lib/types";

// Adjusts where the reaction is cropped in the top split of the generated reel.
// Saves position_x / position_y back to the reaction_videos row (global per reaction —
// the renderer reads these same values). Mirrors the quick-react positioning UI.
export function ReactionPositionModal({
  onClose,
  onSaved,
  reaction,
}: {
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
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
    setPosition({ x: clampPosition(nextX), y: clampPosition(nextY) });
  }

  async function savePosition() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("reaction_videos")
        .update({ position_x: Math.round(position.x), position_y: Math.round(position.y) })
        .eq("id", reaction.id)
        .eq("avatar_id", reaction.avatar_id);
      if (error) throw error;
      toast.success("Posição da reaction salva");
      await onSaved?.();
      onClose();
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
              Ajuste o rosto dentro da parte superior do split (divisão) para não cortar.
            </p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">Fechar</Button>
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
                Arraste o vídeo no topo ou use os controles. O render final usa esses mesmos valores.
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
