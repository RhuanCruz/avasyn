import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import type { JobStatus } from "@/lib/types";

// A render item is either a server-side reel_job (authoritative status, picked up
// by polling) or a transient client-side item covering the pre-job phase
// (preparing/downloading the source video before the reel_job row exists).
export type RenderItemStatus = "preparing" | "downloading" | JobStatus;

export type RenderItem = {
  key: string;
  jobId: string | null;
  title: string;
  thumbnailUrl: string | null;
  status: RenderItemStatus;
  errorMessage: string | null;
  outputPath: string | null;
  caption: string | null;
  platformPostUrl: string | null;
  createdAt: number;
};

// Handle returned by startItem so the generation flow can drive the local
// lifecycle until the reel_job is created and polling takes over.
export type RenderHandle = {
  setDownloading: () => void;
  attachJob: (jobId: string) => void;
  fail: (message: string) => void;
};

type LocalItem = {
  localId: string;
  jobId: string | null;
  title: string;
  thumbnailUrl: string | null;
  status: "preparing" | "downloading" | "pending" | "error";
  errorMessage: string | null;
  createdAt: number;
};

type RenderQueueValue = {
  items: RenderItem[];
  activeCount: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  startItem: (input: { title: string; thumbnailUrl?: string | null }) => RenderHandle;
};

const ACTIVE_STATUSES: RenderItemStatus[] = [
  "preparing",
  "downloading",
  "pending",
  "processing",
  "posting",
];

// Jobs created in this window are surfaced so recently-finished renders stay
// visible for review. Active jobs are virtually always inside it.
const RECENT_WINDOW_MS = 60 * 60 * 1000;
const POLL_INTERVAL_MS = 4000;

const RenderQueueContext = createContext<RenderQueueValue | null>(null);

export function useRenderQueue() {
  const ctx = useContext(RenderQueueContext);
  if (!ctx) throw new Error("useRenderQueue must be used within a RenderQueueProvider");
  return ctx;
}

export function isActiveStatus(status: RenderItemStatus) {
  return ACTIVE_STATUSES.includes(status);
}

export function RenderQueueProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [locals, setLocals] = useState<LocalItem[]>([]);
  const [dbItems, setDbItems] = useState<RenderItem[]>([]);

  const fetchJobs = useCallback(async () => {
    if (!user) {
      setDbItems([]);
      return;
    }
    const sinceIso = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from("reel_jobs")
      .select("id, status, error_message, output_path, caption, platform_post_url, created_at, clip_url, source_video:source_videos(name)")
      .eq("user_id", user.id)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) return; // transient; next tick retries
    const rows = (data ?? []) as unknown as Array<{
      id: string;
      status: JobStatus;
      error_message: string | null;
      output_path: string | null;
      caption: string | null;
      platform_post_url: string | null;
      created_at: string;
      clip_url: string | null;
      source_video: { name: string | null } | { name: string | null }[] | null;
    }>;
    setDbItems(
      rows.map((row) => {
        const source = Array.isArray(row.source_video) ? row.source_video[0] : row.source_video;
        return {
          key: `job:${row.id}`,
          jobId: row.id,
          title: source?.name?.trim() || "Renderização",
          thumbnailUrl: null,
          status: row.status,
          errorMessage: row.error_message,
          outputPath: row.output_path,
          caption: row.caption,
          platformPostUrl: row.platform_post_url,
          createdAt: Date.parse(row.created_at),
        };
      }),
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      setDbItems([]);
      return;
    }
    void fetchJobs();
    const interval = window.setInterval(() => void fetchJobs(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [user, fetchJobs]);

  // Once a local item's job shows up in the DB, drop the local copy — the DB row
  // is authoritative from there on.
  useEffect(() => {
    if (dbItems.length === 0) return;
    const dbJobIds = new Set(dbItems.map((item) => item.jobId));
    setLocals((current) => current.filter((local) => !(local.jobId && dbJobIds.has(local.jobId))));
  }, [dbItems]);

  const startItem = useCallback(
    (input: { title: string; thumbnailUrl?: string | null }): RenderHandle => {
      const localId = crypto.randomUUID();
      setLocals((current) => [
        {
          localId,
          jobId: null,
          title: input.title.trim() || "Renderização",
          thumbnailUrl: input.thumbnailUrl ?? null,
          status: "preparing",
          errorMessage: null,
          createdAt: Date.now(),
        },
        ...current,
      ]);
      setOpen(true);

      const patch = (changes: Partial<LocalItem>) =>
        setLocals((current) =>
          current.map((local) => (local.localId === localId ? { ...local, ...changes } : local)),
        );

      return {
        setDownloading: () => patch({ status: "downloading" }),
        attachJob: (jobId: string) => {
          patch({ jobId, status: "pending" });
          void fetchJobs();
        },
        fail: (message: string) => {
          patch({ status: "error", errorMessage: message });
          setOpen(true);
        },
      };
    },
    [fetchJobs],
  );

  const items = useMemo<RenderItem[]>(() => {
    const dbJobIds = new Set(dbItems.map((item) => item.jobId));
    const localByJob = new Map(
      locals.filter((local) => local.jobId).map((local) => [local.jobId as string, local]),
    );

    const pendingLocals: RenderItem[] = locals
      .filter((local) => !(local.jobId && dbJobIds.has(local.jobId)))
      .map((local) => ({
        key: `local:${local.localId}`,
        jobId: local.jobId,
        title: local.title,
        thumbnailUrl: local.thumbnailUrl,
        status: local.status,
        errorMessage: local.errorMessage,
        outputPath: null,
        caption: null,
        platformPostUrl: null,
        createdAt: local.createdAt,
      }));

    const merged: RenderItem[] = dbItems.map((item) => {
      const local = item.jobId ? localByJob.get(item.jobId) : undefined;
      return local ? { ...item, thumbnailUrl: local.thumbnailUrl ?? item.thumbnailUrl } : item;
    });

    return [...pendingLocals, ...merged].sort((a, b) => {
      const rank = (item: RenderItem) => (isActiveStatus(item.status) ? 0 : 1);
      return rank(a) - rank(b) || b.createdAt - a.createdAt;
    });
  }, [locals, dbItems]);

  const activeCount = useMemo(
    () => items.filter((item) => isActiveStatus(item.status)).length,
    [items],
  );

  const value = useMemo<RenderQueueValue>(
    () => ({ items, activeCount, open, setOpen, startItem }),
    [items, activeCount, open, startItem],
  );

  return <RenderQueueContext.Provider value={value}>{children}</RenderQueueContext.Provider>;
}
