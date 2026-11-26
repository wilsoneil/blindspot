// The Blitz gap: daily rating minus blitz rating, each smoothed as a 30-day average
// (SPEC.md -> "Progress and headline metrics"). Pure: no database.
//
// Ratings come from two places: the rating saved with each imported game (chess.com's rating
// after that game), which gives a full history from the first import, and the daily rating
// snapshot taken by the import job. Each day takes the latest known rating for each time
// control, carried forward over days without games.

import type { Point } from "./series";

export const SMOOTHING_DAYS = 30;
/** A change smaller than this over the last 30 days counts as steady. */
export const STEADY_POINTS = 5;

const DAY = 86_400_000;

export interface RatingSample {
  timeClass: "blitz" | "daily";
  /** When the rating was recorded, in milliseconds. */
  t: number;
  rating: number;
}

export interface BlitzGap {
  /** The smoothed gap, one point a day (at the start of the day, UTC, so today is never in the future). */
  series: Point[];
  gap: number;
  /** 30-day averages and the latest ratings behind the gap. */
  daily: { average: number; latest: number };
  blitz: { average: number; latest: number };
  /** Falling = closing the gap. Compared with 30 days earlier (or the first day there is). */
  trend: "falling" | "rising" | "steady";
}

const dayOf = (t: number) => Math.floor(t / DAY);

/** Null until both a daily and a blitz rating are known. */
export function blitzGap(samples: RatingSample[], now: number): BlitzGap | null {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  if (!sorted.length) return null;

  // Each class's rating at the end of each day.
  const endOfDay = { blitz: new Map<number, number>(), daily: new Map<number, number>() };
  for (const s of sorted) endOfDay[s.timeClass].set(dayOf(s.t), s.rating);

  const today = dayOf(now);
  const latest: Record<"blitz" | "daily", number | null> = { blitz: null, daily: null };
  const recent: Record<"blitz" | "daily", number[]> = { blitz: [], daily: [] };
  const series: Point[] = [];
  let averages: { blitz: number; daily: number } | null = null;
  for (let d = dayOf(sorted[0].t); d <= today; d++) {
    for (const c of ["blitz", "daily"] as const) {
      latest[c] = endOfDay[c].get(d) ?? latest[c];
      if (latest[c] === null) continue;
      recent[c].push(latest[c]);
      if (recent[c].length > SMOOTHING_DAYS) recent[c].shift();
    }
    if (latest.blitz === null || latest.daily === null) continue;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    averages = { blitz: mean(recent.blitz), daily: mean(recent.daily) };
    series.push({ t: d * DAY, v: Math.round(averages.daily - averages.blitz) });
  }
  if (!averages || !series.length) return null;

  const gap = series[series.length - 1].v;
  const then = series.find((p) => p.t >= series[series.length - 1].t - SMOOTHING_DAYS * DAY)!.v;
  const trend = gap <= then - STEADY_POINTS ? "falling" : gap >= then + STEADY_POINTS ? "rising" : "steady";
  return {
    series, gap, trend,
    daily: { average: Math.round(averages.daily), latest: latest.daily! },
    blitz: { average: Math.round(averages.blitz), latest: latest.blitz! },
  };
}
