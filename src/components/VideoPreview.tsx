import { useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

type StorageBucket =
  | "reaction-videos"
  | "generated-reels"
  | "source-videos"
  | "source-thumbnails";

// ---------------------------------------------------------------------------
// Signed URL cache + request batching
//
// Previews are rendered in dense grids across the app. Without coordination
// each card fires its own createSignedUrl request and re-fetches on every
// remount (tab switches, 4s polling, navigation). We:
//   1. Cache signed URLs per bucket+path with a TTL so remounts are instant.
//   2. Batch concurrent requests into a single createSignedUrls call per bucket
//      (collapses N requests into 1 for a grid).
// ---------------------------------------------------------------------------

const SIGN_TTL_SECONDS = 60 * 60 * 2; // 2h
const REFRESH_MARGIN_MS = 60 * 1000; // refresh a minute before expiry

type CacheEntry = { url: string; expiresAt: number };

const urlCache = new Map<string, CacheEntry>();

type PendingQueue = {
  paths: Set<string>;
  resolvers: Map<string, Array<(url: string | null) => void>>;
  timer: ReturnType<typeof setTimeout> | null;
};

const queues = new Map<StorageBucket, PendingQueue>();

function cacheKey(bucket: StorageBucket, path: string) {
  return `${bucket}:${path}`;
}

function readCache(bucket: StorageBucket, path: string): string | null {
  const entry = urlCache.get(cacheKey(bucket, path));
  if (entry && entry.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return entry.url;
  }
  return null;
}

async function flushQueue(bucket: StorageBucket) {
  const queue = queues.get(bucket);
  if (!queue) return;
  queues.delete(bucket);

  const paths = Array.from(queue.paths);
  if (paths.length === 0) return;

  const byPath = new Map<string, string>();
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(paths, SIGN_TTL_SECONDS);
    if (!error && data) {
      for (const item of data) {
        if (item.path && item.signedUrl) {
          byPath.set(item.path, item.signedUrl);
        }
      }
    }
  } catch {
    // fall through — resolvers get null and components show the empty state
  }

  const expiresAt = Date.now() + SIGN_TTL_SECONDS * 1000;
  for (const path of paths) {
    const url = byPath.get(path) ?? null;
    if (url) urlCache.set(cacheKey(bucket, path), { url, expiresAt });
    for (const resolve of queue.resolvers.get(path) ?? []) resolve(url);
  }
}

function requestSignedUrl(bucket: StorageBucket, path: string): Promise<string | null> {
  const cached = readCache(bucket, path);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    let queue = queues.get(bucket);
    if (!queue) {
      queue = { paths: new Set(), resolvers: new Map(), timer: null };
      queues.set(bucket, queue);
    }
    queue.paths.add(path);
    const list = queue.resolvers.get(path) ?? [];
    list.push(resolve);
    queue.resolvers.set(path, list);
    if (!queue.timer) {
      queue.timer = setTimeout(() => void flushQueue(bucket), 16);
    }
  });
}

function useSignedUrl(bucket: StorageBucket, path: string | null, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(() =>
    path ? readCache(bucket, path) : null,
  );

  useEffect(() => {
    if (!path || !enabled) return;

    const cached = readCache(bucket, path);
    if (cached) {
      setUrl(cached);
      return;
    }

    let active = true;
    void requestSignedUrl(bucket, path).then((next) => {
      if (active) setUrl(next);
    });
    return () => {
      active = false;
    };
  }, [bucket, path, enabled]);

  return url;
}

// ---------------------------------------------------------------------------
// Lazy mount — only load media once the card is near the viewport.
// ---------------------------------------------------------------------------

function useInView(rootMargin = "400px") {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}

type StorageVideoPreviewProps = {
  bucket: "reaction-videos" | "generated-reels" | "source-videos";
  path: string | null;
  aspect?: "video" | "reel";
  showTitle?: boolean;
  title: string;
};

export function StorageVideoPreview({
  aspect = "video",
  bucket,
  path,
  showTitle = true,
  title,
}: StorageVideoPreviewProps) {
  const { ref, inView } = useInView();
  const url = useSignedUrl(bucket, path, inView && Boolean(path));
  const aspectCls = aspect === "reel" ? "aspect-[9/16]" : "aspect-video";

  return (
    <div className="flex flex-col gap-2">
      {showTitle ? <p className="text-sm font-medium">{title}</p> : null}
      <div className={`${aspectCls} w-full overflow-hidden rounded-md border border-border bg-black`} ref={ref}>
        {!path ? (
          <PreviewPlaceholder text="Vídeo ainda não disponível." />
        ) : !url ? (
          <PreviewSkeleton />
        ) : (
          <video
            className="h-full w-full bg-black object-contain"
            controls
            playsInline
            preload="metadata"
            // Seek to a frame so a poster shows instead of a black box.
            src={`${url}#t=0.1`}
          />
        )}
      </div>
    </div>
  );
}

export function StorageImagePreview({
  aspect = "square",
  path,
  title,
}: {
  aspect?: "square" | "reel" | "video";
  path: string | null;
  title: string;
}) {
  const { ref, inView } = useInView();
  const url = useSignedUrl("source-thumbnails", path, inView && Boolean(path));
  const cls = aspectClass(aspect);

  return (
    <div className={`${cls} w-full overflow-hidden rounded-md border border-border bg-secondary`} ref={ref}>
      {!url ? (
        path ? (
          <PreviewSkeleton />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-3 text-center text-sm text-muted-foreground">
            {title}
          </div>
        )
      ) : (
        <img
          alt={title}
          className="h-full w-full bg-black object-cover"
          loading="lazy"
          src={url}
        />
      )}
    </div>
  );
}

function aspectClass(aspect: "square" | "reel" | "video") {
  if (aspect === "reel") return "aspect-[9/16]";
  if (aspect === "video") return "aspect-video";
  return "aspect-square";
}

type ClipUrlPreviewProps = {
  url: string;
};

export function ClipUrlPreview({ url }: ClipUrlPreviewProps) {
  const embedUrl = useMemo(() => getYoutubeEmbedUrl(url), [url]);
  const isDirectVideo = /\.(mp4|mov|webm)(\?.*)?$/i.test(url);

  if (embedUrl) {
    return (
      <div className="flex flex-col gap-2">
        <p className="truncate text-sm font-medium">{url}</p>
        <iframe
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="aspect-video w-full rounded-md border border-border bg-black"
          loading="lazy"
          src={embedUrl}
          title={url}
        />
      </div>
    );
  }

  if (isDirectVideo) {
    return (
      <div className="flex flex-col gap-2">
        <p className="truncate text-sm font-medium">{url}</p>
        <video
          className="aspect-video w-full rounded-md border border-border bg-black object-contain"
          controls
          playsInline
          preload="metadata"
          src={`${url}#t=0.1`}
        />
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="truncate text-sm font-medium">{url}</p>
      <a
        className="mt-2 inline-flex text-sm text-muted-foreground underline underline-offset-4"
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        Abrir clip em outra aba
      </a>
    </div>
  );
}

function PreviewSkeleton() {
  return <div className="h-full w-full animate-pulse bg-secondary" />;
}

function PreviewPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-secondary p-4 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function getYoutubeEmbedUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    if (url.hostname.includes("youtube.com")) {
      const shortsId = url.pathname.startsWith("/shorts/")
        ? url.pathname.split("/")[2]
        : null;
      const watchId = url.searchParams.get("v");
      const id = shortsId ?? watchId;
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
  } catch {
    return null;
  }

  return null;
}
