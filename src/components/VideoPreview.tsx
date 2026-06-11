import { useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";

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
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSignedUrl() {
      if (!path) {
        setUrl(null);
        return;
      }

      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 30);

      if (active) {
        setUrl(error ? null : data.signedUrl);
      }
    }

    void loadSignedUrl();

    return () => {
      active = false;
    };
  }, [bucket, path]);

  if (!path) {
    return <EmptyPreview aspect={aspect} showTitle={showTitle} title={title} text="Vídeo ainda não disponível." />;
  }

  if (!url) {
    return <EmptyPreview aspect={aspect} showTitle={showTitle} title={title} text="Carregando preview..." />;
  }

  return (
    <div className="flex flex-col gap-2">
      {showTitle ? <p className="text-sm font-medium">{title}</p> : null}
      <video
        className={`${aspect === "reel" ? "aspect-[9/16]" : "aspect-video"} w-full rounded-md border border-border bg-black object-contain`}
        controls
        preload="metadata"
        src={url}
      />
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
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadSignedUrl() {
      if (!path) {
        setUrl(null);
        return;
      }
      const { data, error } = await supabase.storage
        .from("source-thumbnails")
        .createSignedUrl(path, 60 * 30);
      if (active) setUrl(error ? null : data.signedUrl);
    }
    void loadSignedUrl();
    return () => {
      active = false;
    };
  }, [path]);

  if (!url) {
    return (
      <div className={`flex ${aspectClass(aspect)} items-center justify-center rounded-md border border-border bg-secondary p-3 text-center text-sm text-muted-foreground`}>
        {title}
      </div>
    );
  }

  return (
    <img
      alt={title}
      className={`${aspectClass(aspect)} w-full rounded-md border border-border bg-black object-cover`}
      loading="lazy"
      src={url}
    />
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
          preload="metadata"
          src={url}
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

function EmptyPreview({
  aspect,
  showTitle,
  text,
  title,
}: {
  aspect: "video" | "reel";
  showTitle: boolean;
  text: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {showTitle ? <p className="text-sm font-medium">{title}</p> : null}
      <div className={`flex ${aspect === "reel" ? "aspect-[9/16]" : "aspect-video"} w-full items-center justify-center rounded-md border border-border bg-secondary p-4 text-center text-sm text-muted-foreground`}>
        {text}
      </div>
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
