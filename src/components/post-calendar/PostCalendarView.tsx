import { useState } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { addMonths, monthLabel } from "@/lib/calendar-utils";
import { invokeFunction } from "@/lib/api";
import type { ReelJob, SocialAccount, SocialPlatform } from "@/lib/types";
import { CalendarAgendaList } from "./CalendarAgendaList";
import { CalendarMonthGrid } from "./CalendarMonthGrid";
import { PostDetailModal } from "./PostDetailModal";
import { RescheduleModal } from "./RescheduleModal";
import { SchedulePostsWizard } from "./scheduler/SchedulePostsWizard";

type ViewMode = "month" | "list";
type PlatformFilter = "all" | SocialPlatform;

const ALL_PLATFORMS: SocialPlatform[] = ["instagram", "youtube"];
const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
};

type ConnectResponse = { url: string };

type Props = {
  accounts: SocialAccount[];
  avatarId: string;
  posts: ReelJob[];
  onRefresh: () => Promise<void>;
};

function getPostPlatforms(post: ReelJob, accounts: SocialAccount[]): SocialPlatform[] {
  if (post.reel_job_targets && post.reel_job_targets.length > 0) {
    return [...new Set(post.reel_job_targets.map((t) => t.platform))];
  }
  const account = accounts.find((a) => a.id === post.account_id);
  return account ? [account.platform] : [];
}

export function PostCalendarView({ accounts, avatarId, posts, onRefresh }: Props) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [mode, setMode] = useState<ViewMode>("month");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<SocialPlatform | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selectedPost, setSelectedPost] = useState<ReelJob | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const activeAccounts = accounts.filter((a) => a.active);
  const connectedPlatforms = new Set(activeAccounts.map((a) => a.platform));
  const missingPlatforms = ALL_PLATFORMS.filter((p) => !connectedPlatforms.has(p));

  const filteredPosts = platformFilter === "all"
    ? posts
    : posts.filter((post) => getPostPlatforms(post, accounts).includes(platformFilter));

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
    setSelectedIds(new Set(filteredPosts.map((p) => p.id)));
  }

  function selectErrors() {
    setSelectedIds(new Set(filteredPosts.filter((p) => p.status === "error").map((p) => p.id)));
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

  async function handleConnect(platform: SocialPlatform) {
    setConnectingPlatform(platform);
    try {
      const redirectUrl = `${window.location.origin}/avatars/${avatarId}?tab=calendario&connected=${platform}`;
      const response = await invokeFunction<ConnectResponse>("zernio-connect-url", {
        redirectUrl,
        avatarId,
        platform,
      });
      window.location.href = response.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao iniciar conexão");
      setConnectingPlatform(null);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const resp = await invokeFunction<{ count?: number; returned?: number }>(
        "zernio-sync-accounts",
        { avatarId },
      );
      if ((resp?.count ?? 0) > 0) {
        toast.success("Contas sincronizadas");
      } else {
        toast.warning(
          `Nenhuma conta nova encontrada no Zernio${resp?.returned ? ` (${resp.returned} retornada(s), mas nenhuma suportada)` : ""}.`,
        );
      }
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect(accountId: string) {
    setDisconnectingId(accountId);
    try {
      const account = accounts.find((a) => a.id === accountId);
      await invokeFunction("disconnect-account", { accountId });
      toast.success(`${account ? PLATFORM_LABELS[account.platform] : "Conta"} desconectada`);
      setConfirmDisconnectId(null);
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao desconectar");
    } finally {
      setDisconnectingId(null);
    }
  }

  const errorCount = filteredPosts.filter((p) => p.status === "error").length;
  const reschedulableCount = posts.filter(
    (p) => p.scheduled_post_at && ["pending", "rendered", "error", "processing"].includes(p.status)
  ).length;

  async function handleScheduled() {
    setWizardOpen(false);
    await onRefresh();
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
          {/* Platform filter tabs */}
          <div className="tabs" style={{ marginTop: 0 }}>
            <button
              className={`tab ${platformFilter === "all" ? "active" : ""}`}
              onClick={() => setPlatformFilter("all")}
              type="button"
            >
              Todas
            </button>
            {ALL_PLATFORMS.map((p) => (
              <button
                key={p}
                className={`tab ${platformFilter === p ? "active" : ""}`}
                onClick={() => setPlatformFilter(p)}
                type="button"
              >
                <Icon name={p} size={12} style={{ marginRight: 4 }} />
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>

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

          {activeAccounts.length > 0 && (
            <Button onClick={() => setWizardOpen(true)} size="sm">
              <Icon name="plus" size={14} style={{ marginRight: 4 }} />
              Agendar posts
            </Button>
          )}
          {reschedulableCount > 0 && (
            <Button onClick={() => setRescheduleOpen(true)} size="sm" variant="outline">
              Editar agenda
            </Button>
          )}
        </div>
      </div>

      {/* Accounts bar: connected accounts + connect buttons for missing platforms */}
      <div className="flex flex-wrap items-center gap-2" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
        {activeAccounts.map((account) => (
          <div key={account.id} className="flex items-center gap-1">
            {confirmDisconnectId === account.id ? (
              <>
                <span className="text-xs muted">
                  Desconectar @{account.username ?? account.display_name}?
                </span>
                <Button
                  disabled={disconnectingId === account.id}
                  onClick={() => void handleDisconnect(account.id)}
                  size="sm"
                  variant="outline"
                >
                  {disconnectingId === account.id ? "..." : "Confirmar"}
                </Button>
                <Button
                  disabled={disconnectingId === account.id}
                  onClick={() => setConfirmDisconnectId(null)}
                  size="sm"
                  variant="outline"
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <button
                className="flex items-center gap-1 text-xs"
                onClick={() => setConfirmDisconnectId(account.id)}
                style={{ background: "var(--surface-2)", borderRadius: 6, padding: "3px 8px", border: "1px solid var(--border)", cursor: "pointer" }}
                title={`Desconectar ${PLATFORM_LABELS[account.platform]}`}
                type="button"
              >
                <Icon name={account.platform} size={12} />
                <span>{account.username ?? account.display_name}</span>
                <Icon name="x" size={10} style={{ color: "var(--text-muted)", marginLeft: 2 }} />
              </button>
            )}
          </div>
        ))}

        {missingPlatforms.map((platform) => (
          <Button
            disabled={connectingPlatform !== null}
            key={platform}
            onClick={() => void handleConnect(platform)}
            size="sm"
            variant="outline"
          >
            <Icon name={platform} size={12} style={{ marginRight: 4 }} />
            {connectingPlatform === platform
              ? "Redirecionando..."
              : `+ ${PLATFORM_LABELS[platform]}`}
          </Button>
        ))}

        <Button
          disabled={syncing}
          onClick={() => void handleSync()}
          size="sm"
          variant="outline"
          title="Buscar contas conectadas no Zernio"
        >
          <Icon name="refresh" size={12} style={{ marginRight: 4 }} />
          {syncing ? "Sincronizando..." : "Sincronizar"}
        </Button>
      </div>

      {mode === "list" && filteredPosts.length > 0 ? (
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
        <CalendarMonthGrid month={cursor} onSelect={setSelectedPost} posts={filteredPosts} />
      ) : (
        <CalendarAgendaList
          onSelect={setSelectedPost}
          onToggleSelect={toggleSelect}
          posts={filteredPosts}
          selectedIds={selectedIds}
          selectMode={selectMode}
        />
      )}

      {wizardOpen && activeAccounts.length > 0 ? (
        <SchedulePostsWizard
          accounts={activeAccounts}
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
