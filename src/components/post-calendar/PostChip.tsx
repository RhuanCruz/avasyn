import { StatusPill } from "@/components/operator-ui";
import type { ReelJob } from "@/lib/types";

type Props = {
  post: ReelJob;
  compact?: boolean;
  onSelect: (post: ReelJob) => void;
};

export function PostChip({ compact = false, onSelect, post }: Props) {
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
      <StatusPill kind="job" status={post.status} />
    </button>
  );
}
