import { useEffect, useState } from "react";

import { Icon, Pill } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { StorageVideoPreview } from "@/components/VideoPreview";

import { isActiveStatus, useRenderQueue } from "./RenderQueueContext";
import type { RenderItem, RenderItemStatus } from "./RenderQueueContext";

type PillTone = "neutral" | "base" | "reaction" | "ok" | "warn" | "err" | "info" | "violet";

function statusMeta(status: RenderItemStatus): { label: string; tone: PillTone } {
  switch (status) {
    case "preparing":
      return { label: "Preparando", tone: "neutral" };
    case "downloading":
      return { label: "Baixando vídeo", tone: "info" };
    case "pending":
      return { label: "Na fila", tone: "neutral" };
    case "processing":
      return { label: "Renderizando", tone: "info" };
    case "rendered":
      return { label: "Pronto", tone: "ok" };
    case "posting":
      return { label: "Postando", tone: "violet" };
    case "posted":
      return { label: "Postado", tone: "ok" };
    case "error":
      return { label: "Erro", tone: "err" };
    default:
      return { label: status, tone: "neutral" };
  }
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "agora";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `há ${hours} h`;
}

function isViewable(item: RenderItem) {
  return (item.status === "rendered" || item.status === "posted") && Boolean(item.outputPath);
}

// Single global entry point: floating button + slide-in stack of sheets.
// Rendered once from AppShell so it is present on every authenticated screen.
export function RenderQueueLauncher() {
  const { items, activeCount, open, setOpen } = useRenderQueue();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = selectedKey ? items.find((item) => item.key === selectedKey) ?? null : null;

  // Reset the nested detail when the sheet is closed.
  useEffect(() => {
    if (!open) setSelectedKey(null);
  }, [open]);

  // If the selected item disappears (e.g. aged out of the window), drop back.
  useEffect(() => {
    if (selectedKey && !items.some((item) => item.key === selectedKey)) setSelectedKey(null);
  }, [items, selectedKey]);

  return (
    <>
      <FloatingButton activeCount={activeCount} onClick={() => setOpen(!open)} />

      {open ? (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 70, backdropFilter: "blur(2px)" }}
        >
          <ListSheet
            dimmed={Boolean(selected)}
            items={items}
            onBack={() => setSelectedKey(null)}
            onClose={() => setOpen(false)}
            onSelect={(item) => setSelectedKey(item.key)}
          />
          {selected ? (
            <DetailSheet item={selected} onClose={() => setSelectedKey(null)} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function FloatingButton({
  activeCount,
  onClick,
}: {
  activeCount: number;
  onClick: () => void;
}) {
  const busy = activeCount > 0;
  return (
    <button
      aria-label="Renderizações"
      className="btn"
      onClick={onClick}
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 40,
        gap: 8,
        paddingLeft: 12,
        paddingRight: busy ? 8 : 14,
        boxShadow: busy ? "0 8px 26px rgba(124,108,255,.45)" : "0 8px 24px rgba(0,0,0,.3)",
        background: busy ? "var(--accent-bg-2)" : "var(--surface)",
        borderColor: busy ? "var(--accent)" : undefined,
      }}
      type="button"
    >
      <Icon className={busy ? "spin" : undefined} name={busy ? "refresh" : "film"} size={15} />
      <span>{busy ? "Renderizando" : "Render"}</span>
      {busy ? (
        <span
          style={{
            minWidth: 20,
            height: 20,
            padding: "0 6px",
            borderRadius: 10,
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
  );
}

const SHEET_BASE: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: 420,
  maxWidth: "94vw",
  borderRadius: 0,
  borderLeft: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  transition: "transform .22s ease, opacity .22s ease",
};

function ListSheet({
  dimmed,
  items,
  onBack,
  onClose,
  onSelect,
}: {
  dimmed: boolean;
  items: RenderItem[];
  onBack: () => void;
  onClose: () => void;
  onSelect: (item: RenderItem) => void;
}) {
  const activeCount = items.filter((item) => isActiveStatus(item.status)).length;
  return (
    <aside
      className="panel"
      onClick={(event) => {
        event.stopPropagation();
        if (dimmed) onBack();
      }}
      style={{
        ...SHEET_BASE,
        zIndex: 71,
        transform: dimmed ? "translateX(-34px) scale(.965)" : "none",
        opacity: dimmed ? 0.55 : 1,
        filter: dimmed ? "brightness(.8)" : "none",
        pointerEvents: dimmed ? "none" : "auto",
      }}
    >
      <SheetHeader
        onClose={onClose}
        subtitle={activeCount > 0 ? `${activeCount} em andamento` : "Tudo em dia"}
        title="Renderizações"
      />
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {items.length === 0 ? (
          <div className="empty" style={{ padding: "44px 12px" }}>
            <div>
              <h3>Nada renderizando</h3>
              <p>Os vídeos que você mandar gerar aparecem aqui com o progresso.</p>
            </div>
          </div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {items.map((item) => (
              <RenderRow item={item} key={item.key} onOpen={() => onSelect(item)} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function SheetHeader({
  onBack,
  onClose,
  subtitle,
  title,
}: {
  onBack?: () => void;
  onClose: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div
      className="flex items-center gap-3"
      style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}
    >
      {onBack ? (
        <Button onClick={onBack} size="sm" variant="outline" title="Voltar">
          <Icon name="arrow-right" size={14} style={{ transform: "rotate(180deg)" }} />
        </Button>
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 className="text-lg truncate">{title}</h2>
        <p className="page-subtitle" style={{ margin: 0 }}>{subtitle}</p>
      </div>
      <Button onClick={onClose} size="sm" variant="outline" title="Fechar">
        <Icon name="x" />
      </Button>
    </div>
  );
}

function RenderRow({ item, onOpen }: { item: RenderItem; onOpen: () => void }) {
  const meta = statusMeta(item.status);
  const active = isActiveStatus(item.status);
  const viewable = isViewable(item);

  return (
    <div
      className="card"
      onClick={viewable ? onOpen : undefined}
      style={{
        padding: 10,
        display: "flex",
        gap: 11,
        alignItems: "center",
        cursor: viewable ? "pointer" : "default",
      }}
    >
      <Thumb item={item} onOpen={onOpen} viewable={viewable} />

      <div className="col" style={{ gap: 5, minWidth: 0, flex: 1 }}>
        <div className="flex items-center justify-between gap-2">
          <span className="line-clamp-1 text-sm" style={{ fontWeight: 500 }}>{item.title}</span>
          <span className="text-xs muted" style={{ flexShrink: 0 }}>{relativeTime(item.createdAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={meta.tone} withDot={!active}>
            {active ? <Icon className="spin" name="refresh" size={11} style={{ marginRight: 4 }} /> : null}
            {meta.label}
          </Pill>
          {viewable ? <span className="text-xs muted">Toque para ver</span> : null}
        </div>
        {item.errorMessage ? (
          <span className="line-clamp-2 text-xs" style={{ color: "var(--err)" }}>{item.errorMessage}</span>
        ) : null}
      </div>

      {viewable ? <Icon name="chevron-right" size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} /> : null}
    </div>
  );
}

function Thumb({ item, onOpen, viewable }: { item: RenderItem; onOpen: () => void; viewable: boolean }) {
  const active = isActiveStatus(item.status);
  return (
    <button
      className="overflow-hidden"
      disabled={!viewable}
      onClick={(event) => {
        event.stopPropagation();
        if (viewable) onOpen();
      }}
      style={{
        width: 46,
        height: 62,
        borderRadius: 8,
        border: "1px solid var(--border)",
        flexShrink: 0,
        padding: 0,
        position: "relative",
        cursor: viewable ? "pointer" : "default",
        background: item.thumbnailUrl ? "var(--surface-3)" : "var(--surface-2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      type="button"
    >
      {item.thumbnailUrl ? (
        <img alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" src={item.thumbnailUrl} />
      ) : (
        <Icon
          className={active ? "spin" : undefined}
          name={active ? "refresh" : "film"}
          size={16}
          style={{ color: "var(--text-muted)" }}
        />
      )}
      {viewable ? (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,.32)",
          }}
        >
          <Icon name="play" size={18} style={{ color: "white" }} />
        </span>
      ) : null}
    </button>
  );
}

function DetailSheet({ item, onClose }: { item: RenderItem; onClose: () => void }) {
  const meta = statusMeta(item.status);
  return (
    <aside
      className="panel"
      onClick={(event) => event.stopPropagation()}
      style={{ ...SHEET_BASE, zIndex: 72, boxShadow: "-18px 0 40px rgba(0,0,0,.4)" }}
    >
      <SheetHeader onBack={onClose} onClose={onClose} subtitle={relativeTime(item.createdAt)} title={item.title} />
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
          <Pill tone={meta.tone} withDot>{meta.label}</Pill>
        </div>

        {item.outputPath ? (
          <StorageVideoPreview
            aspect="reel"
            bucket="generated-reels"
            path={item.outputPath}
            showTitle={false}
            title={item.title}
          />
        ) : (
          <div className="empty" style={{ padding: "40px 12px" }}>
            <div>
              <h3>Vídeo ainda não disponível</h3>
              <p>Assim que a renderização terminar o vídeo aparece aqui.</p>
            </div>
          </div>
        )}

        {item.caption ? (
          <div style={{ marginTop: 16 }}>
            <div className="text-xs muted" style={{ marginBottom: 4 }}>Legenda</div>
            <p className="text-sm" style={{ whiteSpace: "pre-wrap" }}>{item.caption}</p>
          </div>
        ) : null}

        {item.platformPostUrl ? (
          <a
            className="text-sm"
            href={item.platformPostUrl}
            rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 16, color: "var(--accent-hover)" }}
            target="_blank"
          >
            <Icon name="link" size={14} /> Abrir publicação
          </a>
        ) : null}
      </div>
    </aside>
  );
}
