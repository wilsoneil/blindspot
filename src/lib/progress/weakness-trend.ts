// Each weakness's trend in the user's games: the lagging indicator, showing whether training
// carries over to real play (SPEC.md -> "Progress and headline metrics"). Pure: no database.
//
// The daily job saves, per weakness, the share of winning chance it costs per game
// (recency-weighted, games only). The first run fills in the past with one point a week.

import type { Profile, WeaknessEntry } from "../analysis/profile";
import type { Point } from "./series";

const DAY = 86_400_000;
/** Backfilled points start this long after the first game, so the first has some games behind it. */
export const BACKFILL_LEAD_DAYS = 28;
export const BACKFILL_STEP_DAYS = 7;
/** The trend compares today with about this long ago. */
export const TREND_DAYS = 30;
/** Changes smaller than this share of the earlier value count as steady. */
export const STEADY_SHARE = 0.1;

/** The weaknesses worth a history row: every single category with evidence, and the pairs shown. */
export function historyEntries(p: Profile): WeaknessEntry[] {
  return [...p.all, ...p.top.filter((e) => e.labels.length > 1)];
}

/** Dates (milliseconds) for the one-off backfill: weekly, from four weeks after the first game to before today. */
export function backfillDates(firstGame: number, now: number): number[] {
  const out: number[] = [];
  for (let t = firstGame + BACKFILL_LEAD_DAYS * DAY; t < now - DAY; t += BACKFILL_STEP_DAYS * DAY) out.push(t);
  return out;
}

export interface Trend {
  /** Share of winning chance lost per game now, and about TREND_DAYS ago (null if no row then). */
  now: number;
  then: number | null;
  direction: "falling" | "rising" | "steady" | null;
  /** For a sparkline, oldest first. */
  points: Point[];
}

/** One weakness's trend from its history rows (any order). Null without rows. */
export function trendOf(rows: { t: number; perGame: number }[], now: number): Trend | null {
  if (!rows.length) return null;
  const points = [...rows].sort((a, b) => a.t - b.t).map((r) => ({ t: r.t, v: r.perGame }));
  const last = points[points.length - 1].v;
  const earlier = points.filter((p) => p.t <= now - TREND_DAYS * DAY).at(-1)?.v ?? null;
  const direction = earlier === null ? null
    : last < earlier * (1 - STEADY_SHARE) ? "falling"
    : last > earlier * (1 + STEADY_SHARE) ? "rising" : "steady";
  return { now: last, then: earlier, direction, points };
}
