import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { PostHistory, ReelJob } from "@/lib/types";

export function DashboardPage() {
  const loadJobs = useCallback(async () => {
    const { data, error } = await supabase
      .from("reel_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) throw error;
    return (data ?? []) as ReelJob[];
  }, []);

  const loadHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from("post_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw error;
    return (data ?? []) as PostHistory[];
  }, []);

  const jobs = useSupabaseQuery(loadJobs, []);
  const history = useSupabaseQuery(loadHistory, []);
  const refreshJobs = jobs.refresh;
  const refreshHistory = history.refresh;

  async function processQueue() {
    try {
      await invokeFunction("reel-processor");
      await refreshJobs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao processar fila");
    }
  }

  async function processJob(jobId: string) {
    try {
      await invokeFunction("reel-processor", { jobId });
      toast.success("Job enviado para processamento");
      await refreshJobs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao processar job");
    }
  }

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-reel-jobs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reel_jobs" },
        () => {
          void refreshJobs();
          void refreshHistory();
        },
      )
      .subscribe();

    const interval = window.setInterval(() => {
      void refreshJobs();
      void refreshHistory();
    }, 5000);

    return () => {
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [refreshHistory, refreshJobs]);

  const counts = jobs.data.reduce(
    (acc, job) => {
      acc[job.status] = (acc[job.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <>
      <PageHeader
        action={
          <Button onClick={() => void processQueue()} variant="outline">
            Processar fila
          </Button>
        }
        description="Acompanhe renderização, postagem e histórico em tempo real."
        title="Dashboard"
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Pendentes", counts.pending ?? 0],
          ["Processando", (counts.processing ?? 0) + (counts.posting ?? 0)],
          ["Renderizados", counts.rendered ?? 0],
          ["Com erro", counts.error ?? 0],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Fila de jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Clip</TableHead>
                  <TableHead>Criado</TableHead>
                  <TableHead>Erro</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.data.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <StatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{job.clip_url}</TableCell>
                    <TableCell>{new Date(job.created_at).toLocaleString()}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {job.error_message ?? "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {job.status === "pending" || job.status === "error" ? (
                        <Button
                          onClick={() => void processJob(job.id)}
                          size="sm"
                          variant="outline"
                        >
                          Processar
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Histórico</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {history.data.map((post) => (
                <div
                  className="rounded-md border border-border bg-background p-3"
                  key={post.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge status={post.status} type="post" />
                    <span className="text-xs text-muted-foreground">
                      {new Date(post.created_at).toLocaleString()}
                    </span>
                  </div>
                  {post.platform_post_url ? (
                    <a
                      className="mt-2 block truncate text-sm text-primary hover:underline"
                      href={post.platform_post_url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {post.platform_post_url}
                    </a>
                  ) : null}
                  {post.error_message ? (
                    <p className="mt-2 text-sm text-destructive">{post.error_message}</p>
                  ) : null}
                </div>
              ))}
              {history.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma postagem ainda.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
