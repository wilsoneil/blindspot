// "Find the move" positions from the user's own games (SPEC.md -> "Training modes"): the
// positions before their stored mistakes, for weaknesses Lichess puzzles can't train.
// Difficulty is approximated by how subtle the best move is (src/lib/analysis/accepted.ts).

import type { Db } from "../db";
import { positionRating, type PositionCalibration } from "./position-rating";
import type { TrainingPuzzle } from "./select";

const PAGE = 1000;

interface MistakeRow {
  id: number;
  fen: string;
  labels: string[];
  accepted_moves: string[] | null;
  subtlety: number | null;
  played_san: string;
  played_uci: string;
  refutation: string;
  best_san: string;
  played_at: string;
}

/** Mistake ids the user has already trained. */
export async function attemptedMistakeIds(db: Pick<Db, "from">, userId: string): Promise<Set<number>> {
  const ids = new Set<number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("puzzle_attempts")
      .select("mistake_id").eq("user_id", userId).not("mistake_id", "is", null)
      .order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read past attempts: ${error.message}`);
    for (const row of data as { mistake_id: number }[]) ids.add(row.mistake_id);
    if (data.length < PAGE) return ids;
  }
}

/** Turns a stored mistake into a trainable position. */
export function positionFromMistake(m: MistakeRow, level: number, calibration: PositionCalibration | null = null): TrainingPuzzle {
  return {
    id: `m${m.id}`, fen: m.fen, moves: [], rating: positionRating(level, m.subtlety, calibration), themes: [], labels: m.labels,
    position: {
      mistakeId: m.id, accepted: m.accepted_moves ?? [], playedSan: m.played_san, playedUci: m.played_uci,
      refutation: (m.refutation ?? "").split(" ").filter(Boolean), bestSan: m.best_san, playedAt: m.played_at,
    },
  };
}

export interface PositionSelect {
  userId: string;
  /** Mistake label keys the positions must all carry, e.g. ["pawnDecisions", "phaseTransition"]. */
  labelKeys: string[];
  count: number;
  level: number;
  /** The fitted own-position rule, once there are enough attempts (position-rating.ts). */
  calibration?: PositionCalibration | null;
  /** Prefer positions whose stand-in rating is near this (mixed modes); default: random. */
  near?: number;
  /** Ids ("m123") already served in this session. */
  exclude?: Iterable<string>;
  random?: () => number;
}

/**
 * Untrained positions carrying all the labels. Returns [] (and logs why) if the accepted
 * moves haven't been worked out yet, e.g. before migration 0006 or the first run.
 */
export async function selectPositions(db: Pick<Db, "from">, o: PositionSelect): Promise<TrainingPuzzle[]> {
  if (o.labelKeys.length === 0 || o.count <= 0) return [];
  const random = o.random ?? Math.random;
  const exclude = new Set(o.exclude ?? []);
  const done = await attemptedMistakeIds(db, o.userId);

  const rows: MistakeRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("mistakes")
      .select("id, fen, labels, accepted_moves, subtlety, played_san, played_uci, refutation, best_san, played_at")
      .eq("user_id", o.userId).contains("labels", o.labelKeys).not("accepted_moves", "is", null)
      .order("id").range(from, from + PAGE - 1);
    if (error) {
      if (/accepted_moves|subtlety/.test(error.message)) {
        console.error("Positions aren't ready: apply migration 0006 and run the analysis workflow.");
        return [];
      }
      throw new Error(`Could not read positions: ${error.message}`);
    }
    rows.push(...(data as MistakeRow[]));
    if (data.length < PAGE) break;
  }

  const fresh = rows
    .filter((m) => (m.accepted_moves?.length ?? 0) > 0 && !done.has(m.id) && !exclude.has(`m${m.id}`))
    .map((m) => ({ p: positionFromMistake(m, o.level, o.calibration), key: random() }));
  if (o.near !== undefined) {
    const near = o.near;
    fresh.sort((a, b) => Math.abs(a.p.rating - near) - Math.abs(b.p.rating - near) || a.key - b.key);
  } else {
    fresh.sort((a, b) => a.key - b.key);
  }
  return fresh.slice(0, o.count).map((f) => f.p);
}
