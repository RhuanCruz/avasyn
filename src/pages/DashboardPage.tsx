import { useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import {
  AppTopbar,
  AvatarBubble,
  AvatarSwitcher,
  Icon,
  KpiCard,
  Pill,
  StatusPill,
  formatDate,
} from "@/components/operator-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAvatarState } from "@/hooks/useAvatarState";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Avatar, PostHistory, ReelJob } from "@/lib/types";

type DashboardSnapshot = {
  avatars: Avatar[];
  jobs: ReelJob[];
  history: PostHistory[];
};

export function DashboardPage() {
  const {
    avatars,
    refresh: refreshAvatars,
    selectedAvatarId,
    selectedAvatar,
    setSelectedAvatarId,
  } = useAvatarState();

  const loadSnapshot = useCallback(async (): Promise<DashboardSnapshot> => {
    const jobsQuery = supabase
      .from("reel_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);
    const historyQuery = supabase
      .from("post_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (selectedAvatarId) {
      jobsQuery.eq("avatar_id", selectedAvatarId);
      historyQuery.eq("avatar_id", selectedAvatarId);
    }

    const [jobsResult, historyResult] = await Promise.all([jobsQuery, historyQuery]);

    if (jobsResult.error) throw jobsResult.error;
    if (historyResult.error) throw historyResult.error;

    return {
      avatars,
      jobs: (jobsResult.data ?? []) as ReelJob[],
      history: (historyResult.data ?? []) as PostHistory[],
    };
  }, [avatars, selectedAvatarId]);

  const snapshot = useSupabaseQuery(loadSnapshot, {
    avatars: [],
    jobs: [],
    history: [],
  });

  useEffect(() => {
    const channel = supabase
      .channel(`dashboard-reel-jobs-${selectedAvatarId ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "reel_jobs" }, () => {
        void snapshot.refresh();
        void refreshAvatars();
      })
      .subscribe();

    const interval = window.setInterval(() => {
      void snapshot.refresh();
    }, 5000);

    return () => {
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [refreshAvatars, selectedAvatarId, snapshot.refresh]);

  async function processQueue() {
    try {
      await invokeFunction("reel-processor");
      await snapshot.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao processar fila");
    }
  }

  async function processJob(jobId: string) {
    try {
      await invokeFunction("reel-processor", { jobId });
      toast.success("Job enviado para processamento");
      await snapshot.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao processar job");
    }
  }

  async function openGeneratedVideo(job: ReelJob) {
    if (!job.output_path) {
      toast.error("Video ainda nao disponivel");
      return;
    }

    const { data, error } = await supabase.storage
      .from("generated-reels")
      .createSignedUrl(job.output_path, 60 * 30);

    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Falha ao abrir video");
      return;
    }

    window.open(data.signedUrl, "_blank", "noreferrer");
  }

  const counts = snapshot.data.jobs.reduce(
    (acc, job) => {
      acc[job.status] = (acc[job.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const recentAvatars = avatars.slice(0, 4);

  return (
    <>
      <AppTopbar
        actions={
          <>
            <AvatarSwitcher
              avatars={avatars}
              onChange={setSelectedAvatarId}
              selectedAvatarId={selectedAvatarId}
            />
            <Button onClick={() => void processQueue()} size="sm" variant="outline">
              <Icon name="refresh" />
              Processar fila
            </Button>
          </>
        }
        crumbs={[
          { label: "Workspace", icon: "home", href: "/" },
          { label: "Dashboard" },
        ]}
      />

      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Dashboard operacional</h1>
            <p className="page-subtitle">
              Visao global da fila, historico e saude do workspace
              {selectedAvatar ? ` filtrada por ${selectedAvatar.name}.` : "."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link className={buttonVariants({ variant: "outline" })} to="/avatars">
              Avatares
            </Link>
            {selectedAvatarId ? (
              <Link className={buttonVariants()} to={`/avatars/${selectedAvatarId}`}>
                Abrir avatar
              </Link>
            ) : null}
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon="clock"
            label="Pendentes"
            sub="Aguardando processamento"
            value={counts.pending ?? 0}
          />
          <KpiCard
            icon="refresh"
            label="Em processamento"
            sub="Renderizando ou enviando"
            tone="info"
            value={(counts.processing ?? 0) + (counts.posting ?? 0)}
          />
          <KpiCard
            icon="check-circle"
            label="Renderizados"
            sub="Prontos para publicar"
            tone="ok"
            value={counts.rendered ?? 0}
          />
          <KpiCard
            icon="alert"
            label="Com erro"
            sub="Precisam revisao"
            tone="err"
            value={counts.error ?? 0}
          />
        </section>

        <section
          className="mt-4 grid gap-4"
          style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(320px,0.9fr)" }}
        >
          <div className="panel overflow-hidden">
            <div className="page-header" style={{ marginBottom: 0, padding: 18 }}>
              <div>
                <h2 className="text-lg">Fila de jobs</h2>
                <p className="page-subtitle">
                  {selectedAvatar ? "Jobs do avatar ativo." : "Jobs recentes de todos os avatares."}
                </p>
              </div>
              <Pill tone="neutral">{snapshot.data.jobs.length} itens</Pill>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Clip</th>
                    <th>Criado</th>
                    <th>Erro</th>
                    <th>Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.data.jobs.length === 0 ? (
                    <tr>
                      <td className="muted" colSpan={5}>
                        Nenhum job encontrado para este contexto.
                      </td>
                    </tr>
                  ) : (
                    snapshot.data.jobs.map((job) => (
                      <tr key={job.id}>
                        <td><StatusPill kind="job" status={job.status} /></td>
                        <td>
                          <div className="col" style={{ gap: 4 }}>
                            <span className="truncate" style={{ maxWidth: 320 }}>{job.clip_url}</span>
                            {job.source_video_id ? (
                              <span className="text-xs mono muted">{job.source_video_id.slice(0, 8)}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="mono">{formatDate(job.created_at)}</td>
                        <td className="truncate muted" style={{ maxWidth: 220 }}>
                          {job.error_message ?? "—"}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            {job.status === "rendered" && job.output_path ? (
                              <Button onClick={() => void openGeneratedVideo(job)} size="sm" variant="outline">
                                Ver
                              </Button>
                            ) : (
                              <Button onClick={() => void processJob(job.id)} size="sm" variant="outline">
                                Rodar
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="panel card-pad">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg">Avatares ativos</h2>
                  <p className="page-subtitle">Contextos editoriais com acesso rapido.</p>
                </div>
                <Link className={buttonVariants({ variant: "outline" })} to="/avatars">
                  Gerenciar
                </Link>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {recentAvatars.length === 0 ? (
                  <div className="empty" style={{ padding: "28px 12px" }}>
                    <div>
                      <h3>Nenhum avatar ainda</h3>
                      <p>Crie o primeiro avatar para organizar contas, biblioteca e formatos.</p>
                    </div>
                  </div>
                ) : (
                  recentAvatars.map((avatar) => (
                    <Link
                      className="nav-item"
                      key={avatar.id}
                      to={`/avatars/${avatar.id}`}
                    >
                      <AvatarBubble avatar={avatar} />
                      <div className="col" style={{ gap: 3, minWidth: 0, flex: 1 }}>
                        <span className="truncate">{avatar.name}</span>
                        <span className="text-xs muted truncate">
                          {avatar.persona_summary ?? "Sem resumo editorial"}
                        </span>
                      </div>
                      <StatusPill kind="avatar" status={avatar.status} />
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="panel card-pad">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg">Historico</h2>
                  <p className="page-subtitle">Posts enviados ou agendados recentemente.</p>
                </div>
                <Pill tone="violet">{snapshot.data.history.length} eventos</Pill>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {snapshot.data.history.length === 0 ? (
                  <div className="empty" style={{ padding: "28px 12px" }}>
                    <div>
                      <h3>Sem historico ainda</h3>
                      <p>Os envios publicados vao aparecer aqui.</p>
                    </div>
                  </div>
                ) : (
                  snapshot.data.history.map((item) => (
                    <div className="card card-pad" key={item.id} style={{ padding: 12 }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="col" style={{ gap: 4, minWidth: 0 }}>
                          <span className="truncate mono">{item.job_id}</span>
                          <span className="text-xs muted">{formatDate(item.posted_at ?? item.created_at)}</span>
                        </div>
                        <StatusPill kind="post" status={item.status} />
                      </div>
                      {item.error_message ? (
                        <p className="mt-2 text-xs" style={{ color: "var(--err)" }}>
                          {item.error_message}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
