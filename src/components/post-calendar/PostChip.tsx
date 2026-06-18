import { Icon, StatusPill } from "@/components/operator-ui";
import type { ReelJob, SocialPlatform } from "@/lib/types";

type Props = {
  post: ReelJob;
  compact?: boolean;
  onSelect: (post: ReelJob) => void;
};

function PlatformIcons({ platforms }: { platforms: SocialPlatform[] }) {
  if (platforms.length === 0) return null;
  return (
    <span className="flex items-center gap-0.5" style={{ flexShrink: 0 }}>
      {platforms.map((p) => (
        <Icon key={p} name={p} size={11} style={{ color: "var(--text-muted)" }} />
      ))}
    </span>
  );
}

export function PostChip({ compact = false, onSelect, post }: Props) {
  const platforms: SocialPlatform[] = post.reel_job_targets && post.reel_job_targets.length > 0
    ? [...new Set(post.reel_job_targets.map((t) => t.platform))]
    : [];

  if (compact) {
    return (
      <button
        className="post-chip-dot"
        onClick={() => onSelect(post)}
        title={post.caption || "Post agendado"}
        type="button"
      />
    );
  }

  return (
    <button
      className="post-chip"
      onClick={() => onSelect(post)}
      type="button"
    >
      <span className="post-chip-caption">{post.caption || "Sem legenda"}</span>
      <span className="flex items-center gap-1">
        <PlatformIcons platforms={platforms} />
        <StatusPill kind="job" status={post.status} />
      </span>
    </button>
  );
}
