import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { StatusPill, formatDate } from "@/components/operator-ui";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { supabase } from "@/lib/supabase";
import type { ReelJob } from "@/lib/types";

export function GeneratedJobsPanel({
  jobIds,
}: {
  jobIds: string[];
}) {
  const [jobs, setJobs] = useState<ReelJob[]>([]);

  const refreshJobs = useCallback(async () => {
    if (jobIds.length === 0) {
      setJobs([]);
      return;
    }

    const { data, error } = await supabase
      .from("reel_jobs")
      .select("*")
      .in("id", jobIds)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(error.message);
      return;
    }

    setJobs((data ?? []) as ReelJob[]);
  }, [jobIds]);

  useEffect(() => {
    void refreshJobs();
    if (jobIds.length === 0) return;

    const interval = window.setInterval(() => {
      void refreshJobs();
    }, 4000);

    return () => window.clearInterval(interval);
  }, [jobIds.length, refreshJobs]);

  return (
    <section className="panel card-pad">
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h2 className="text-lg">05. Vídeos gerados</h2>
          <p className="page-subtitle">
            Aguarde a renderização e revise o vídeo final antes de exportar manualmente.
          </p>
        </div>
      </div>

      {jobIds.length === 0 ? (
        <div className="empty" style={{ padding: "40px 12px" }}>
          <div>
            <h3>Nenhum job criado ainda</h3>
            <p>Os vídeos renderizados vão aparecer aqui para revisão.</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {jobs.map((job) => (
            <GeneratedJobCard
              job={job}
              key={job.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GeneratedJobCard({
  job,
}: {
  job: ReelJob;
}) {
  return (
    <div className="card card-pad">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="col" style={{ gap: 8, minWidth: 0, flex: 1 }}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill kind="job" status={job.status} />
            <span className="text-xs mono muted">{formatDate(job.created_at)}</span>
          </div>
          <div className="truncate text-sm">{job.clip_url}</div>
          {job.error_message ? (
            <div className="text-sm" style={{ color: "var(--err)" }}>
              {job.error_message}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <StorageVideoPreview
          aspect="reel"
          bucket="generated-reels"
          path={job.output_path}
          title="Vídeo gerado"
        />
      </div>
    </div>
  );
}
