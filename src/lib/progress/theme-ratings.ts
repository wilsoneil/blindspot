// A rating per weakness theme, the leading indicator under the headline numbers (SPEC.md ->
// "Progress and headline metrics"). Pure: no database.
//
//   - Weaknesses trained with Lichess puzzles: a Glicko-2 rating replayed, like the Blindspot
//     rating, from the first attempts at puzzles carrying all the weakness's labels.
//   - Weaknesses trained with the user's own positions: no rating (those positions have none),
//     so the share solved within the target time instead.
//   - Openings: nothing yet (their puzzles are found by opening tag, not by label).

import { replay } from "../training/rating";
import { weaknessFromKey } from "../training/sources";

/** First attempts before a theme rating is shown; until then only the count. */
export const MIN_THEME_ATTEMPTS = 10;
const CHANGE_DAYS = 30;

export interface ThemeAttempt {
  /** The puzzle's or position's labels at the time. */
  labels: string[];
  /** Lichess rating at the time; null for an own-game position. */
  puzzleRating: number | null;
  fullySolved: boolean;
  /** Milliseconds. Attempts are passed oldest first. */
  at: number;
}

export type ThemeRating =
  | { kind: "rating"; rating: number; attempts: number; /** Over the last 30 days, if rated before then. */ change: number | null }
  | { kind: "few"; attempts: number }
  | { kind: "own"; attempts: number; solved: number };

/** Null only for weaknesses that can't be trained yet (openings); otherwise a count from zero. */
export function themeRating(key: string, attempts: ThemeAttempt[], now: number): ThemeRating | null {
  const w = weaknessFromKey(key);
  if (!w || w.kind === "opening") return null;

  if (w.kind === "ownGames") {
    const own = attempts.filter((a) => a.puzzleRating === null && w.labelKeys.every((l) => a.labels.includes(l)));
    return { kind: "own", attempts: own.length, solved: own.filter((a) => a.fullySolved).length };
  }

  const rated = attempts.filter((a) => a.puzzleRating !== null && w.puzzleLabels.every((l) => a.labels.includes(l)));
  if (rated.length < MIN_THEME_ATTEMPTS) return { kind: "few", attempts: rated.length };
  const history = replay(rated.map((a) => ({ puzzleRating: a.puzzleRating!, fullySolved: a.fullySolved })));
  const rating = Math.round(history[history.length - 1].rating);
  const cutoff = now - CHANGE_DAYS * 86_400_000;
  const lastBefore = rated.findLastIndex((a) => a.at < cutoff);
  return {
    kind: "rating", rating, attempts: rated.length,
    change: lastBefore >= MIN_THEME_ATTEMPTS - 1 ? rating - Math.round(history[lastBefore].rating) : null,
  };
}
