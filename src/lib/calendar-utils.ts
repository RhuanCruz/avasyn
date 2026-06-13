import type { ReelJob } from "@/lib/types";

export type WeekRow = Date[];

export function buildMonthMatrix(cursor: Date): WeekRow[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Week starts on Sunday (0). Shift so first cell aligns.
  const startOffset = firstDay.getDay();
  const weeks: WeekRow[] = [];
  let current = new Date(year, month, 1 - startOffset);

  while (current <= lastDay || weeks.length === 0 || current.getDay() !== 0) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d += 1) {
      week.push(new Date(current));
      current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
    }
    weeks.push(week);
    if (current > lastDay && current.getDay() === 0) break;
  }

  return weeks;
}

export function formatDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function groupByDay(posts: ReelJob[]): Record<string, ReelJob[]> {
  const result: Record<string, ReelJob[]> = {};
  for (const post of posts) {
    const raw = post.scheduled_post_at ?? post.posted_at;
    if (!raw) continue;
    const key = formatDayKey(new Date(raw));
    (result[key] ??= []).push(post);
  }
  return result;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function monthLabel(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  // Always render in UTC — we store wall-clock SP time as UTC in the DB
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  if (isSameDay(date, today)) return "Hoje";
  if (isSameDay(date, tomorrow)) return "Amanhã";

  return date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

// Minimum lead time before a slot is considered valid (Zernio rejects past/near-now schedules).
const SLOT_LEAD_MS = 5 * 60 * 1000;

export function computeSlots({
  weekdays,
  times,
  count,
  from,
}: {
  weekdays: number[];
  times: string[];
  count: number;
  from?: Date;
}): string[] {
  if (!weekdays.length || !times.length || count <= 0) return [];

  const sortedTimes = [...times].sort();
  // The user's browser runs in their local (São Paulo) timezone, so wall-clock
  // Date construction below matches what we store and show. Skip any slot that is
  // already in the past (or too close to now) so we never send Zernio a past time.
  const minInstant = (from ? from.getTime() : Date.now()) + SLOT_LEAD_MS;
  const slots: string[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  const maxDays = 730;
  let dayCount = 0;

  while (slots.length < count && dayCount < maxDays) {
    if (weekdays.includes(cursor.getDay())) {
      for (const time of sortedTimes) {
        if (slots.length >= count) break;
        const [h, m] = time.split(":").map(Number);
        const slotDate = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate(),
          h,
          m ?? 0,
          0,
          0,
        );
        if (slotDate.getTime() < minInstant) continue;
        const y = cursor.getFullYear();
        const mo = String(cursor.getMonth() + 1).padStart(2, "0");
        const d = String(cursor.getDate()).padStart(2, "0");
        const hh = String(h).padStart(2, "0");
        const mm = String(m ?? 0).padStart(2, "0");
        slots.push(`${y}-${mo}-${d}T${hh}:${mm}:00`);
      }
    }
    dayCount++;
    cursor.setDate(cursor.getDate() + 1);
  }

  return slots;
}
