import { useState } from "react";
import { toast } from "sonner";

import { Icon, Pill } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { getStorageSignedUrl } from "@/lib/storage-client";

import { isActiveStatus, useRenderQueue } from "./RenderQueueContext";
import type { RenderItem, RenderItemStatus } from "./RenderQueueContext";

type PillTone = "neutral" | "base" | "reaction" | "ok" | "warn" | "err" | "info" | "violet";

function statusMeta(status: RenderItemStatus): { label: string; tone: PillTone } {
  switch (status) {
    case "preparing":
      return { label: "Preparando", tone: "neutral" };
    case "downloading":
      return { label: "Baixando vídeo…", tone: "info" };
    case "pending":
      return { label: "Na fila", tone: "neutral" };
    case "processing":
      return { label: "Renderizando…", tone: "info" };
    case "rendered":
      return { label: "Pronto", tone: "ok" };
    case "posting":
      return { label: "Postando…", tone: "violet" };
    case "posted":
      return { label: "Postado", tone: "ok" };
    case "error":
      return { label: "Erro", tone: "err" };
    default:
      return { label: status, tone: "neutral" };
  }
}

// Single global entry point: floating button + slide-in sheet. Rendered once from
// AppShell so it is present on every authenticated screen.
export function RenderQueueLauncher() {
  const { items, activeCount, open, setOpen } = useRenderQueue();

  return (
    <>
      <button
        aria-label="Renderizações"
        className="btn"
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 40,
          gap: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,.28)",
          background: "var(--surface)",
        }}
        type="button"
      >
        <Icon name="film" size={15} />
        <span>Render</span>
        {activeCount > 0 ? (
          <span
            style={{
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 9,
              background: "var(--accent)",
              color: "white",
              fontSize: 11,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 70 }}
        >
          <aside
            className="panel"
            onClick={(event) => event.stopPropagation()}
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: 400,
              maxWidth: "92vw",
              borderRadius: 0,
              borderLeft: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              zIndex: 71,
            }}
          >
            <div className="page-header" style={{ padding: "16px 18px", marginBottom: 0, borderBottom: "1px solid var(--border)" }}>
              <div>
                <h2 className="text-lg">Renderizações</h2>
                <p className="page-subtitle">
                  {activeCount > 0 ? `${activeCount} em andamento` : "Tudo em dia"}
                </p>
              </div>
              <Button onClick={() => setOpen(false)} size="sm" variant="outline">
                <Icon name="x" />
              </Button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
              {items.length === 0 ? (
                <div className="empty" style={{ padding: "40px 12px" }}>
                  <div>
                    <h3>Nada renderizando</h3>
                    <p>Os vídeos que você mandar gerar aparecem aqui com o progresso.</p>
                  </div>
                </div>
              ) : (
                <div className="col" style={{ gap: 10 }}>
                  {items.map((item) => (
                    <RenderRow item={item} key={item.key} />
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function RenderRow({ item }: { item: RenderItem }) {
  const [opening, setOpening] = useState(false);
  const meta = statusMeta(item.status);
  const active = isActiveStatus(item.status);
  const canView = (item.status === "rendered" || item.status === "posted") && Boolean(item.outputPath);

  async function openReel() {
    if (!item.outputPath) return;
    setOpening(true);
    try {
      const url = await getStorageSignedUrl("generated-reels", item.outputPath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao abrir o vídeo");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="card card-pad" style={{ padding: 12 }}>
      <div className="flex items-start gap-3">
        <div
          className="overflow-hidden bg-muted"
          style={{
            width: 44,
            height: 60,
            borderRadius: 6,
            border: "1px solid var(--border)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {item.thumbnailUrl ? (
            <img alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" src={item.thumbnailUrl} />
          ) : (
            <Icon name="film" size={16} style={{ color: "var(--text-muted)" }} />
          )}
        </div>

        <div className="col" style={{ gap: 6, minWidth: 0, flex: 1 }}>
          <span className="line-clamp-2 text-sm">{item.title}</span>
          <div className="flex items-center gap-2">
            <Pill tone={meta.tone} withDot={active}>{meta.label}</Pill>
            {active ? <Icon className="spin" name="refresh" size={12} style={{ color: "var(--text-muted)" }} /> : null}
          </div>
          {item.errorMessage ? (
            <span className="text-xs" style={{ color: "var(--err)" }}>{item.errorMessage}</span>
          ) : null}
          {canView ? (
            <div>
              <Button disabled={opening} onClick={() => void openReel()} size="sm" variant="outline">
                {opening ? "Abrindo…" : "Ver reel"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
