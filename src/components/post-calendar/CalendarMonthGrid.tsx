import {
  buildMonthMatrix,
  formatDayKey,
  groupByDay,
  isSameDay,
} from "@/lib/calendar-utils";
import type { ReelJob } from "@/lib/types";
import { PostChip } from "./PostChip";

const DAY_HEADERS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MAX_CHIPS_PER_DAY = 3;

type Props = {
  month: Date;
  posts: ReelJob[];
  onSelect: (post: ReelJob) => void;
};

export function CalendarMonthGrid({ month, onSelect, posts }: Props) {
  const weeks = buildMonthMatrix(month);
  const byDay = groupByDay(posts);
  const today = new Date();

  return (
    <div className="cal-grid">
      <div className="cal-grid-header">
        {DAY_HEADERS.map((h) => (
          <div className="cal-day-header" key={h}>{h}</div>
        ))}
      </div>

      {weeks.map((week, wi) => (
        <div className="cal-week" key={wi}>
          {week.map((date, di) => {
            const isCurrentMonth = date.getMonth() === month.getMonth();
            const isToday = isSameDay(date, today);
            const key = formatDayKey(date);
            const dayPosts = byDay[key] ?? [];
            const overflow = dayPosts.length - MAX_CHIPS_PER_DAY;

            return (
              <div
                className={[
                  "cal-day",
                  isCurrentMonth ? "" : "cal-day--overflow",
                  isToday ? "cal-day--today" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={`${wi}-${di}`}
              >
                <span className="cal-day-num">{date.getDate()}</span>
                <div className="cal-day-posts">
                  {dayPosts.slice(0, MAX_CHIPS_PER_DAY).map((post) => (
                    <PostChip compact key={post.id} onSelect={onSelect} post={post} />
                  ))}
                  {overflow > 0 ? (
                    <span className="cal-overflow-label">+{overflow}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
