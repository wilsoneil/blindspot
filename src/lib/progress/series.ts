// Line-chart series over the last week, month or all time (SPEC.md -> "Progress and headline
// metrics"). Pure: no database. Used for the Blindspot rating and the Blitz gap.

export interface Point {
  /** Milliseconds since 1970. */
  t: number;
  v: number;
}

export type Range = "week" | "month" | "all";
export const RANGES: Range[] = ["week", "month", "all"];

const DAY = 86_400_000;
const RANGE_DAYS: Record<Exclude<Range, "all">, number> = { week: 7, month: 30 };

/** When a range starts (null for all time). */
export function rangeStart(range: Range, now: number): number | null {
  return range === "all" ? null : now - RANGE_DAYS[range] * DAY;
}

/**
 * The points in a range, oldest first. The value at the start of the range is carried in as
 * a first point, so the line starts at the left edge rather than at the first change.
 */
export function windowed(points: Point[], range: Range, now: number): Point[] {
  const start = rangeStart(range, now);
  if (start === null) return points.slice();
  const before = points.filter((p) => p.t < start).at(-1);
  const inside = points.filter((p) => p.t >= start && p.t <= now);
  return before ? [{ t: start, v: before.v }, ...inside] : inside;
}

/** One point per day (the day's last value), for long ranges with many points. */
export function dailyLast(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const day = Math.floor(p.t / DAY);
    if (out.length && Math.floor(out[out.length - 1].t / DAY) === day) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** The series a chart gets for each range: every point for the week, one a day beyond that. */
export function chartSeries(points: Point[], now: number): Record<Range, Point[]> {
  return {
    week: windowed(points, "week", now),
    month: dailyLast(windowed(points, "month", now)),
    all: dailyLast(points),
  };
}

/** How much the value changed over a range: last minus first, or null with under two points. */
export function change(series: Point[]): number | null {
  return series.length >= 2 ? series[series.length - 1].v - series[0].v : null;
}
