import { Icon, StatusPill } from "@/components/operator-ui";
import { formatDayLabel, formatDayKey, formatTime, groupByDay } from "@/lib/calendar-utils";
import type { ReelJob, SocialPlatform } from "@/lib/types";

type Props = {
  posts: ReelJob[];
  onSelect: (post: ReelJob) => void;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
};

export function CalendarAgendaList({
  onSelect,
  onToggleSelect,
  posts,
  selectedIds,
  selectMode = false,
}: Props) {
  if (posts.length === 0) {
    return (
      <div className="empty" style={{ padding: "40px 20px" }}>
        <div>
          <h3>Nenhum post neste período</h3>
          <p>Posts agendados e publicados aparecerão aqui.</p>
        </div>
      </div>
    );
  }

  const byDay = groupByDay(posts);
  const sortedKeys = Object.keys(byDay).sort();

  return (
    <div className="agenda-list">
      {sortedKeys.map((key) => {
        const dayPosts = byDay[key];
        const label = formatDayLabel(`${key}T00:00:00`);

        return (
          <div className="agenda-group" key={key}>
            <div className="agenda-day-label">{label}</div>
            {dayPosts.map((post) => {
              const timeRaw = post.scheduled_post_at ?? post.posted_at;
              const platforms: SocialPlatform[] =
                post.reel_job_targets && post.reel_job_targets.length > 0
                  ? [...new Set(post.reel_job_targets.map((t) => t.platform))]
                  : [];

              return (
                <button
                  className={`agenda-item ${selectMode && selectedIds?.has(post.id) ? "agenda-item--selected" : ""}`}
                  key={post.id}
                  onClick={() => (selectMode ? onToggleSelect?.(post.id) : onSelect(post))}
                  type="button"
                >
                  {selectMode ? (
                    <span className={`agenda-checkbox ${selectedIds?.has(post.id) ? "checked" : ""}`}>
                      {selectedIds?.has(post.id) ? <Icon name="check" size={12} /> : null}
                    </span>
                  ) : null}
                  <div className="agenda-item-time">
                    <Icon name="clock" size={13} style={{ color: "var(--text-muted)" }} />
                    <span>{timeRaw ? formatTime(timeRaw) : "—"}</span>
                  </div>
                  <div className="agenda-item-body">
                    <span className="agenda-item-caption">
                      {post.caption || "Sem legenda"}
                    </span>
                    <span className="flex items-center gap-1">
                      {platforms.map((p) => (
                        <Icon key={p} name={p} size={12} style={{ color: "var(--text-muted)" }} />
                      ))}
                      <StatusPill kind="job" status={post.status} />
                    </span>
                  </div>
                  {!selectMode ? (
                    <Icon name="chevron-right" size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
