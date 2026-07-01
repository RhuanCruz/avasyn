import { useEffect, useRef, useState } from "react";

import { invokeFunction } from "@/lib/api";

// Buckets that can be signed via the `get-signed-url` edge function.
export type StorageBucket =
  | "reaction-videos"
  | "generated-reels"
  | "source-videos"
  | "source-thumbnails"
  | "presenter-avatar-images";

// ---------------------------------------------------------------------------
// Signed URL cache + request batching
//
// Previews are rendered in dense grids across the app. Without coordination
// each card fires its own createSignedUrl request and re-fetches on every
// remount (tab switches, polling, navigation). We:
//   1. Cache signed URLs per bucket+path with a TTL so remounts are instant.
//   2. Batch concurrent requests into a single get-signed-url call per bucket
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
    const data = await invokeFunction<{ path: string; signedUrl: string | null }[]>(
      "get-signed-url",
      { bucket, paths },
    );
    if (data) {
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

export function useSignedUrl(bucket: StorageBucket, path: string | null, enabled: boolean) {
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
// Lazy mount — only load media once the element is near the viewport.
// ---------------------------------------------------------------------------

export function useInView<T extends HTMLElement = HTMLDivElement>(rootMargin = "400px") {
  const ref = useRef<T | null>(null);
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
