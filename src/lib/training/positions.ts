// "Find the move" positions from the user's own games (SPEC.md -> "Training modes"): the
// positions before their stored mistakes, for weaknesses Lichess puzzles can't train.
// Difficulty is approximated by how subtle the best move is (src/lib/analysis/accepted.ts).

import type { Db } from "../db";
import { readAll } from "../read-all";
import { positionRating, type PositionCalibration } from "./position-rating";
import { attemptedMistakeIds, type TrainingPuzzle } from "./select";

/** The mistake columns a position is built from. */
export const MISTAKE_COLUMNS = "id, fen, labels, accepted_moves, subtlety, played_san, played_uci, refutation, best_san, played_at";

export interface MistakeRow {
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
  /** The user's trained mistake ids, if already loaded (saves reading them again). */
  attempted?: Set<number>;
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
  const done = o.attempted ?? await attemptedMistakeIds(db, o.userId);

  let rows: MistakeRow[];
  try {
    rows = await readAll<MistakeRow>((from, to) =>
      db.from("mistakes").select(MISTAKE_COLUMNS)
        .eq("user_id", o.userId).contains("labels", o.labelKeys).not("accepted_moves", "is", null)
        .order("id").range(from, to), "read positions");
  } catch (e) {
    if (e instanceof Error && /accepted_moves|subtlety/.test(e.message)) {
      console.error("Positions aren't ready: apply migration 0006 and run the analysis workflow.");
      return [];
    }
    throw e;
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
