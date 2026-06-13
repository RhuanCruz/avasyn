import { useState } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { addMonths, monthLabel } from "@/lib/calendar-utils";
import { invokeFunction } from "@/lib/api";
import type { ReelJob, SocialAccount } from "@/lib/types";
import { CalendarAgendaList } from "./CalendarAgendaList";
import { CalendarMonthGrid } from "./CalendarMonthGrid";
import { PostDetailModal } from "./PostDetailModal";
import { RescheduleModal } from "./RescheduleModal";
import { SchedulePostsWizard } from "./scheduler/SchedulePostsWizard";

type ViewMode = "month" | "list";

type Props = {
  accounts: SocialAccount[];
  avatarId: string;
  posts: ReelJob[];
  onRefresh: () => Promise<void>;
};

export function PostCalendarView({ accounts, avatarId, posts, onRefresh }: Props) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [mode, setMode] = useState<ViewMode>("month");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [selectedPost, setSelectedPost] = useState<ReelJob | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function selectAll() {
    setSelectedIds(new Set(posts.map((p) => p.id)));
  }

  function selectErrors() {
    setSelectedIds(new Set(posts.filter((p) => p.status === "error").map((p) => p.id)));
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    try {
      const resp = await invokeFunction<{ deleted: number }>("delete-jobs", {
        jobIds: Array.from(selectedIds),
      });
      toast.success(`${resp.deleted} post${resp.deleted !== 1 ? "s" : ""} excluído${resp.deleted !== 1 ? "s" : ""}`);
      exitSelectMode();
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir");
    } finally {
      setDeleting(false);
    }
  }

  const errorCount = posts.filter((p) => p.status === "error").length;

  const reschedulableCount = posts.filter(
    (p) =>
      p.scheduled_post_at &&
      ["pending", "rendered", "error", "processing"].includes(p.status)
  ).length;

  const activeAccount = accounts.find((a) => a.active) ?? null;

  async function handleScheduled() {
    setWizardOpen(false);
    await onRefresh();
  }

  async function handleDisconnect() {
    if (!activeAccount) return;
    setDisconnecting(true);
    try {
      await invokeFunction("disconnect-account", { accountId: activeAccount.id });
      toast.success("Conta Instagram desconectada");
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao desconectar");
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  }

  return (
    <div className="cal-view">
      <div className="cal-view-header">
        <div className="cal-nav">
          <button
            className="cal-nav-btn"
            onClick={() => setCursor((c) => addMonths(c, -1))}
            type="button"
          >
            <Icon name="chevron-right" size={16} style={{ transform: "scaleX(-1)" }} />
          </button>
          <span className="cal-month-label">{monthLabel(cursor)}</span>
          <button
            className="cal-nav-btn"
            onClick={() => setCursor((c) => addMonths(c, 1))}
            type="button"
          >
            <Icon name="chevron-right" size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="tabs" style={{ marginTop: 0 }}>
            {(["month", "list"] as ViewMode[]).map((v) => (
              <button
                className={`tab ${mode === v ? "active" : ""}`}
                key={v}
                onClick={() => setMode(v)}
                type="button"
              >
                {v === "month" ? "Mês" : "Lista"}
              </button>
            ))}
          </div>

          {activeAccount ? (
            confirmDisconnect ? (
              <div className="flex items-center gap-2">
                <span className="text-xs muted">Desconectar @{activeAccount.username ?? activeAccount.display_name}?</span>
                <Button
                  disabled={disconnecting}
                  onClick={() => void handleDisconnect()}
                  size="sm"
                  variant="outline"
                >
                  {disconnecting ? "..." : "Confirmar"}
                </Button>
                <Button
                  disabled={disconnecting}
                  onClick={() => setConfirmDisconnect(false)}
                  size="sm"
                  variant="outline"
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button onClick={() => setWizardOpen(true)} size="sm">
                  <Icon name="plus" size={14} style={{ marginRight: 4 }} />
                  Agendar posts
                </Button>
                {reschedulableCount > 0 && (
                  <Button onClick={() => setRescheduleOpen(true)} size="sm" variant="outline">
                    Editar agenda
                  </Button>
                )}
                <Button onClick={() => setConfirmDisconnect(true)} size="sm" variant="outline">
                  Desconectar
                </Button>
              </div>
            )
          ) : null}
        </div>
      </div>

      {mode === "list" && posts.length > 0 ? (
        <div className="agenda-toolbar">
          {selectMode ? (
            <>
              <span className="text-sm">{selectedIds.size} selecionado{selectedIds.size !== 1 ? "s" : ""}</span>
              <div className="flex items-center gap-2">
                <Button onClick={selectAll} size="sm" variant="outline">Todos</Button>
                {errorCount > 0 && (
                  <Button onClick={selectErrors} size="sm" variant="outline">
                    Erros ({errorCount})
                  </Button>
                )}
                <Button
                  disabled={selectedIds.size === 0 || deleting}
                  onClick={() => void handleBulkDelete()}
                  size="sm"
                  variant="outline"
                  style={{ borderColor: "var(--err)", color: "var(--err)" } as React.CSSProperties}
                >
                  {deleting ? "Excluindo..." : `Excluir (${selectedIds.size})`}
                </Button>
                <Button disabled={deleting} onClick={exitSelectMode} size="sm" variant="outline">
                  Cancelar
                </Button>
              </div>
            </>
          ) : (
            <Button onClick={() => setSelectMode(true)} size="sm" variant="outline">
              <Icon name="check" size={14} style={{ marginRight: 4 }} />
              Selecionar
            </Button>
          )}
        </div>
      ) : null}

      {mode === "month" ? (
        <CalendarMonthGrid month={cursor} onSelect={setSelectedPost} posts={posts} />
      ) : (
        <CalendarAgendaList
          onSelect={setSelectedPost}
          onToggleSelect={toggleSelect}
          posts={posts}
          selectedIds={selectedIds}
          selectMode={selectMode}
        />
      )}

      {wizardOpen && activeAccount ? (
        <SchedulePostsWizard
          account={activeAccount}
          avatarId={avatarId}
          onClose={() => setWizardOpen(false)}
          onScheduled={() => void handleScheduled()}
        />
      ) : null}

      {selectedPost ? (
        <PostDetailModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onCancelled={async () => {
            setSelectedPost(null);
            await onRefresh();
          }}
        />
      ) : null}

      {rescheduleOpen ? (
        <RescheduleModal
          avatarId={avatarId}
          pendingCount={reschedulableCount}
          onClose={() => setRescheduleOpen(false)}
          onRescheduled={async () => {
            setRescheduleOpen(false);
            await onRefresh();
          }}
        />
      ) : null}
    </div>
  );
}
