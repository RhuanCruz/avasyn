import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/auth/AuthContext";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Automation, ReactionVideo, SocialAccount } from "@/lib/types";

import { AutomationCard } from "./AutomationCard";
import { AutomationDetailModal } from "./AutomationDetailModal";
import { AutomationPostsModal } from "./AutomationPostsModal";
import { AutomationWizard } from "./AutomationWizard";
import { activationBlockers, type AutomationRow, draftFromAutomation } from "./types";

type Props = {
  avatarId: string;
  initialTheme?: string | null;
  onInitialThemeConsumed?: () => void;
};

type Snapshot = {
  automations: Automation[];
  reactions: ReactionVideo[];
  accounts: SocialAccount[];
  jobsToday: { automation_id: string | null }[];
};

const EMPTY: Snapshot = { automations: [], reactions: [], accounts: [], jobsToday: [] };

export function AutomacoesTab({ avatarId, initialTheme, onInitialThemeConsumed }: Props) {
  const { user } = useAuth();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTheme, setWizardTheme] = useState<string | null>(null);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [detail, setDetail] = useState<Automation | null>(null);
  const [postsFor, setPostsFor] = useState<Automation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Snapshot> => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const [automations, reactions, accounts, jobsToday] = await Promise.all([
      supabase.from("automations").select("*").eq("avatar_id", avatarId).order("created_at", { ascending: false }),
      supabase.from("reaction_videos").select("*").eq("avatar_id", avatarId).order("created_at", { ascending: false }),
      supabase.from("social_accounts").select("*").eq("avatar_id", avatarId).eq("active", true),
      supabase.from("reel_jobs").select("automation_id").eq("avatar_id", avatarId).gte("created_at", dayStart.toISOString()),
    ]);
    for (const r of [automations, reactions, accounts, jobsToday]) {
      if (r.error) throw r.error;
    }
    return {
      automations: (automations.data ?? []) as Automation[],
      reactions: (reactions.data ?? []) as ReactionVideo[],
      accounts: (accounts.data ?? []) as SocialAccount[],
      jobsToday: (jobsToday.data ?? []) as { automation_id: string | null }[],
    };
  }, [avatarId]);

  const { data, loading, refresh } = useSupabaseQuery(load, EMPTY);

  // Realtime: refresh when runs or automations change for this avatar.
  useEffect(() => {
    const channel = supabase
      .channel(`automations-${avatarId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "automation_runs", filter: `avatar_id=eq.${avatarId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "automations", filter: `avatar_id=eq.${avatarId}` }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [avatarId, refresh]);

  // Open the wizard pre-filled when a theme is handed off from the Trends tab.
  useEffect(() => {
    const theme = initialTheme?.trim();
    if (!theme) return;
    setEditing(null);
    setWizardTheme(theme);
    setWizardOpen(true);
    onInitialThemeConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTheme]);

  const postsTodayMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const job of data.jobsToday) {
      if (!job.automation_id) continue;
      map.set(job.automation_id, (map.get(job.automation_id) ?? 0) + 1);
    }
    return map;
  }, [data.jobsToday]);

  const accountLabel = useCallback(
    (ids: string[]) => {
      const names = ids
        .map((id) => data.accounts.find((a) => a.id === id))
        .filter(Boolean)
        .map((a) => a!.username ?? a!.display_name);
      if (names.length === 0) return null;
      if (names.length === 1) return names[0];
      return `${names[0]} +${names.length - 1}`;
    },
    [data.accounts],
  );

  // After activating, eagerly generate a few preview posts so the user can
  // immediately see the resulting caption/overlay/video choice scheduled.
  async function seedPreview(automationId: string) {
    try {
      const resp = await invokeFunction<{ jobsCreated: number }>("automation-runner", {
        automationId,
        seed: 3,
      });
      if (resp.jobsCreated > 0) {
        toast.success(`${resp.jobsCreated} vídeo${resp.jobsCreated !== 1 ? "s" : ""} de preview em produção`);
      } else {
        toast.message("Ativada, mas nenhum vídeo de preview foi gerado (veja execuções).");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar preview");
    }
  }

  async function handleSave(row: AutomationRow, activate: boolean) {
    if (!user) return;
    const statusPatch = activate
      ? { status: "active", active: true }
      : { status: "draft", active: false };
    try {
      let automationId = editing?.id ?? null;
      if (editing) {
        const { error } = await supabase
          .from("automations")
          .update({ ...row, ...statusPatch, last_error_message: null, updated_at: new Date().toISOString() })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase
          .from("automations")
          .insert({ ...row, ...statusPatch, user_id: user.id, avatar_id: avatarId })
          .select("id")
          .single();
        if (error) throw error;
        automationId = inserted.id as string;
      }
      toast.success(activate ? "Automação ativada" : "Rascunho salvo");
      setWizardOpen(false);
      setEditing(null);
      await refresh();
      if (activate && automationId) void seedPreview(automationId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar automação");
    }
  }

  async function handleToggle(automation: Automation) {
    setBusyId(automation.id);
    try {
      if (automation.status === "active") {
        const { error } = await supabase
          .from("automations")
          .update({ status: "paused", active: false, updated_at: new Date().toISOString() })
          .eq("id", automation.id);
        if (error) throw error;
        toast.success("Automação pausada");
      } else {
        const blockers = activationBlockers(draftFromAutomation(automation));
        if (blockers.length > 0) {
          toast.error(`Não dá pra ativar: falta ${blockers.join(", ")}`);
          return;
        }
        const { error } = await supabase
          .from("automations")
          .update({ status: "active", active: true, last_error_message: null, updated_at: new Date().toISOString() })
          .eq("id", automation.id);
        if (error) throw error;
        toast.success("Automação ativada");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao alterar status");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRun(automation: Automation) {
    setRunningId(automation.id);
    try {
      // Generate one video per upcoming slot for the week (skips slots already filled).
      const weekSlots = (automation.days_of_week?.length ?? 0) * (automation.post_times?.length ?? 0);
      const seed = Math.max(1, Math.min(50, weekSlots || 1));
      const resp = await invokeFunction<{ runsCreated: number; jobsCreated: number; skipped: number }>(
        "automation-runner",
        { automationId: automation.id, seed },
      );
      toast.success(
        resp.jobsCreated > 0
          ? `${resp.jobsCreated} vídeo${resp.jobsCreated !== 1 ? "s" : ""} em produção para os próximos horários`
          : "Nenhum vídeo novo gerado (slots já preenchidos ou sem candidato — veja execuções)",
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao rodar automação");
    } finally {
      setRunningId(null);
    }
  }

  function openNew() {
    setEditing(null);
    setWizardTheme(null);
    setWizardOpen(true);
  }

  function openEdit(automation: Automation) {
    setEditing(automation);
    setWizardTheme(null);
    setWizardOpen(true);
  }

  if (loading) {
    return (
      <div className="mt-4 col" style={{ gap: 8 }}>
        <Skeleton className="h-24 w-full rounded" />
        <Skeleton className="h-24 w-full rounded" />
      </div>
    );
  }

  const noReactions = data.reactions.length === 0;

  return (
    <div className="mt-4 col" style={{ gap: 14 }}>
      <div className="flex items-center justify-between">
        <p className="text-sm muted">Automações buscam vídeos por tema e geram reacts no automático.</p>
        <Button disabled={noReactions} onClick={openNew} size="sm">
          <Icon name="plus" size={14} style={{ marginRight: 4 }} />
          Nova automação
        </Button>
      </div>

      {noReactions && (
        <div className="card card-pad" style={{ padding: 12 }}>
          <p className="text-sm">
            Adicione ao menos uma <strong>reaction</strong> a este avatar na Biblioteca antes de criar uma automação.
          </p>
        </div>
      )}

      {data.automations.length === 0 ? (
        !noReactions && (
          <div className="empty" style={{ padding: "32px 12px" }}>
            <div>
              <h3>Nenhuma automação</h3>
              <p>Crie sua primeira automação para gerar reacts automaticamente.</p>
              <Button onClick={openNew} style={{ marginTop: 12 }}>
                Criar primeira automação
              </Button>
            </div>
          </div>
        )
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {data.automations.map((automation) => (
            <AutomationCard
              accountLabel={accountLabel(automation.account_ids?.length ? automation.account_ids : automation.account_id ? [automation.account_id] : [])}
              automation={automation}
              key={automation.id}
              onDetails={() => setDetail(automation)}
              onEdit={() => openEdit(automation)}
              onPosts={() => setPostsFor(automation)}
              onRun={() => void handleRun(automation)}
              onToggle={() => void handleToggle(automation)}
              postsToday={postsTodayMap.get(automation.id) ?? 0}
              running={runningId === automation.id}
              toggling={busyId === automation.id}
            />
          ))}
        </div>
      )}

      {wizardOpen && (
        <AutomationWizard
          accounts={data.accounts}
          existing={editing}
          initialTheme={wizardTheme}
          onClose={() => {
            setWizardOpen(false);
            setEditing(null);
            setWizardTheme(null);
          }}
          onReactionsRefresh={refresh}
          onSave={handleSave}
          reactions={data.reactions}
        />
      )}

      {detail && <AutomationDetailModal automation={detail} onClose={() => setDetail(null)} />}

      {postsFor && <AutomationPostsModal automation={postsFor} onClose={() => setPostsFor(null)} />}
    </div>
  );
}
