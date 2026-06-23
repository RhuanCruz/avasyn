import { Icon, Pill, formatDate, formatNumber } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { formatDuration, platformLabel, platformTone, type QuickReactSource } from "@/components/content/quickReact";
import type { TrendVideo } from "@/lib/types";

export function trendToSource(video: TrendVideo): QuickReactSource {
  return {
    result_url: video.source_url,
    title: video.title,
    thumbnail_url: video.thumbnail_url,
    platform: video.platform,
    external_id: video.external_id,
    duration_s: video.duration_s,
    author_username: video.author_username,
    view_count: video.view_count,
    like_count: video.like_count,
    published_at: video.published_at,
  };
}

export function isRising(video: TrendVideo): boolean {
  if (video.is_trending) return false;
  if (!video.published_at) return false;
  const ageHours = (Date.now() - Date.parse(video.published_at)) / 3_600_000;
  return Number.isFinite(ageHours) && ageHours <= 72 && video.trend_score >= 800;
}

export function TrendVideoCard({
  video,
  saved,
  saving,
  generating,
  onPreview,
  onGenerate,
  onSave,
  onUseInAutomation,
}: {
  video: TrendVideo;
  saved: boolean;
  saving: boolean;
  generating: boolean;
  onPreview: (video: TrendVideo) => void;
  onGenerate: (video: TrendVideo) => void;
  onSave: (video: TrendVideo) => void;
  onUseInAutomation: (video: TrendVideo) => void;
}) {
  const rising = isRising(video);

  return (
    <article className="card card-pad">
      <button
        className="overflow-hidden bg-muted"
        onClick={() => onPreview(video)}
        style={{
          aspectRatio: "9 / 16",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "block",
          padding: 0,
          position: "relative",
          width: "100%",
        }}
        type="button"
      >
        {video.thumbnail_url ? (
          <img
            alt={video.title ?? "Trend"}
            className="h-full w-full object-cover"
            loading="lazy"
            src={video.thumbnail_url}
          />
        ) : (
          <div className="empty h-full">
            <div>
              <h3>Sem thumbnail</h3>
              <p>{platformLabel(video.platform)}</p>
            </div>
          </div>
        )}
        {video.is_trending ? (
          <div style={{ position: "absolute", top: 6, left: 6 }}>
            <Pill tone="err">🔥 Em trend</Pill>
          </div>
        ) : rising ? (
          <div style={{ position: "absolute", top: 6, left: 6 }}>
            <Pill tone="warn">📈 Subindo</Pill>
          </div>
        ) : null}
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Pill tone={platformTone(video.platform)}>{platformLabel(video.platform)}</Pill>
        {video.duration_s ? <Pill tone="neutral">{formatDuration(video.duration_s)}</Pill> : null}
      </div>

      <div className="mt-3 col" style={{ gap: 6 }}>
        <span className="line-clamp-2 text-sm">{video.title ?? "Sem título"}</span>
        {video.author_username ? <span className="text-xs muted">{video.author_username}</span> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs muted">
        {video.view_count ? <span>{formatNumber(video.view_count)} views</span> : null}
        {video.trend_score ? <span>{formatNumber(video.trend_score)}/h</span> : null}
        {video.published_at ? <span>{formatDate(video.published_at)}</span> : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button onClick={() => onPreview(video)} size="sm" variant="outline">
          Ver
        </Button>
        <Button disabled={generating} onClick={() => onGenerate(video)} size="sm" variant="outline">
          {generating ? "Enviando..." : "Gerar"}
        </Button>
        <Button disabled={saved || saving} onClick={() => onSave(video)} size="sm">
          {saved ? "Na biblioteca" : saving ? "Salvando..." : "Salvar"}
        </Button>
        <Button onClick={() => onUseInAutomation(video)} size="sm" variant="outline" title="Criar automação com este tema">
          <Icon name="zap" size={12} style={{ marginRight: 4 }} />
          Automação
        </Button>
      </div>
    </article>
  );
}
