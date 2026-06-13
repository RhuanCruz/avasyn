import { useState } from "react";
import { toast } from "sonner";

import { Icon, StatusPill } from "@/components/operator-ui";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { Button } from "@/components/ui/button";
import { invokeFunction } from "@/lib/api";
import { formatTime } from "@/lib/calendar-utils";
import type { ReelJob } from "@/lib/types";

type Props = {
  post: ReelJob;
  onClose: () => void;
  onCancelled: () => void;
};

const CANCELLABLE = new Set(["pending", "rendered", "posting"]);

export function PostDetailModal({ post, onClose, onCancelled }: Props) {
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const canCancel = CANCELLABLE.has(post.status) && Boolean(post.scheduled_post_at ?? post.account_id);
  const isPosting = post.status === "posting";

  const scheduledTime = post.scheduled_post_at
    ? `${new Date(post.scheduled_post_at).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })} às ${formatTime(post.scheduled_post_at)}`
    : null;

  async function handleCancel() {
    setCancelling(true);
    try {
      await invokeFunction("cancel-scheduled-post", { jobId: post.id });
      toast.success("Agendamento cancelado");
      onCancelled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao cancelar");
      setCancelling(false);
      setConfirmCancel(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480, maxHeight: "90vh", overflow: "auto", padding: 20 }}
      >
        <div className="flex items-start justify-between gap-3" style={{ marginBottom: 16 }}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill kind="job" status={post.status} />
            {scheduledTime && <span className="text-xs muted">{scheduledTime}</span>}
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>

        {post.output_path ? (
          <div style={{ marginBottom: 16 }}>
            <StorageVideoPreview
              aspect="reel"
              bucket="generated-reels"
              path={post.output_path}
              showTitle={false}
              title={post.caption || "Post"}
            />
          </div>
        ) : null}

        <div className="col" style={{ gap: 10 }}>
          {post.caption ? (
            <div className="card card-pad" style={{ padding: 12 }}>
              <div className="text-xs muted" style={{ marginBottom: 4 }}>Legenda</div>
              <p className="text-sm" style={{ whiteSpace: "pre-wrap" }}>{post.caption}</p>
            </div>
          ) : null}

          {post.overlay_text ? (
            <div className="card card-pad" style={{ padding: 12 }}>
              <div className="text-xs muted" style={{ marginBottom: 4 }}>Overlay</div>
              <p className="text-sm">{post.overlay_text}</p>
            </div>
          ) : null}

          {post.platform_post_url ? (
            <a
              className="flex items-center gap-2 text-sm"
              href={post.platform_post_url}
              rel="noreferrer"
              style={{ color: "var(--accent-hover)" }}
              target="_blank"
            >
              <Icon name="link" size={13} />
              Ver post no Instagram
            </a>
          ) : null}

          {post.error_message ? (
            <div className="card card-pad" style={{ padding: 12, borderColor: "var(--err)" }}>
              <div className="text-xs muted" style={{ marginBottom: 4 }}>Erro</div>
              <p className="text-sm" style={{ color: "var(--err)" }}>{post.error_message}</p>
            </div>
          ) : null}
        </div>

        {canCancel ? (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            {confirmCancel ? (
              <div className="col" style={{ gap: 8 }}>
                {isPosting ? (
                  <p className="text-xs muted">
                    Este post já foi enviado ao Zernio para agendamento. Cancelandoaqui ele será removido do banco mas pode ainda ser publicado pelo Zernio.
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    disabled={cancelling}
                    onClick={() => void handleCancel()}
                    variant="outline"
                    style={{ borderColor: "var(--err)", color: "var(--err)" } as React.CSSProperties}
                  >
                    {cancelling ? "Cancelando..." : "Confirmar cancelamento"}
                  </Button>
                  <Button disabled={cancelling} onClick={() => setConfirmCancel(false)} variant="outline">
                    Voltar
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={() => setConfirmCancel(true)}
                variant="outline"
                style={{ borderColor: "var(--err)", color: "var(--err)" } as React.CSSProperties}
              >
                Cancelar agendamento
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
