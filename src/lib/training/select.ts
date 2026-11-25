// Chooses the puzzles that train one weakness (SPEC.md -> "Training modes").
// Server-only: reads the puzzle store and the user's attempts.
//
// A weakness is a single label key ("fork:missed") or a pair ("fork:missed" + "rookEndgame").
// Lichess puzzles train it when every label maps to a puzzle theme; a pair needs puzzles
// carrying both. Positional labels (no Lichess theme) are trained with the user's own
// positions (step 10), and openings once they are mapped to Lichess tags (step 11).

import type { Db } from "../db";
import { labelForKey, puzzleLabelForKey } from "../labels";

/** Where a weakness's training positions come from. */
export type TrainingSource =
  | { kind: "puzzles"; puzzleLabels: string[] }
  | { kind: "ownGames" } // "find the move" positions from the user's games
  | { kind: "notYet"; reason: "opening" | "unknown" };

export function trainingSource(labelKeys: string[]): TrainingSource {
  if (labelKeys.some((k) => k.startsWith("opening:"))) return { kind: "notYet", reason: "opening" };
  if (labelKeys.length === 0 || labelKeys.some((k) => !labelForKey(k))) return { kind: "notYet", reason: "unknown" };
  const puzzleLabels = labelKeys.map(puzzleLabelForKey);
  if (puzzleLabels.some((l) => l === null)) return { kind: "ownGames" };
  return { kind: "puzzles", puzzleLabels: [...new Set(puzzleLabels as string[])] };
}

/**
 * The level when none is given: the Glicko-2 starting rating. Pages pass the user's
 * Blindspot rating (src/lib/training/rating.ts).
 */
export const DEFAULT_LEVEL = 1500;

/** Rating windows tried in turn around the user's level, widening when too few puzzles fit. */
export const RATING_WINDOWS = [100, 200, 400, Infinity];

const SLICE = 200; // candidate rows read per query
const SLICES_PER_WINDOW = 3;
const PAGE = 1000;

export interface TrainingPuzzle {
  id: string;
  fen: string; // position before the opponent's setup move
  moves: string[]; // UCI; moves[0] is the opponent's setup move, then the solution
  rating: number;
  themes: string[];
  labels: string[];
}

interface PuzzleDbRow {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  themes: string[];
  labels: string[];
}

export interface SelectOptions {
  userId: string;
  /** Puzzle-store labels the puzzles must all carry (from trainingSource). */
  puzzleLabels: string[];
  /** How many puzzles to return (fewer if not enough unseen ones exist). */
  count: number;
  level?: number;
  /** Puzzles already served in this session, on top of the ones with attempts. */
  exclude?: Iterable<string>;
  /** The user's attempted puzzle ids, if already loaded (saves reading them again). */
  attempted?: Set<string>;
  /** Random number source, replaceable in tests. */
  random?: () => number;
}

/** Puzzle ids the user has already attempted (any mode). */
export async function attemptedPuzzleIds(db: Pick<Db, "from">, userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("puzzle_attempts")
      .select("puzzle_id").eq("user_id", userId).not("puzzle_id", "is", null)
      .order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read past attempts: ${error.message}`);
    for (const row of data as { puzzle_id: string }[]) ids.add(row.puzzle_id);
    if (data.length < PAGE) return ids;
  }
}

/**
 * Unseen puzzles carrying all the given labels, as close to the user's level as possible:
 * the narrowest rating window with enough of them, in random order.
 */
export async function selectPuzzles(db: Pick<Db, "from">, o: SelectOptions): Promise<TrainingPuzzle[]> {
  if (o.puzzleLabels.length === 0 || o.count <= 0) return [];
  const level = o.level ?? DEFAULT_LEVEL;
  const random = o.random ?? Math.random;
  const skip = new Set(o.attempted ?? await attemptedPuzzleIds(db, o.userId));
  for (const id of o.exclude ?? []) skip.add(id);

  const pool = new Map<string, PuzzleDbRow>();
  for (const w of RATING_WINDOWS) {
    const inWindow = <Q extends { gte: (c: string, v: number) => Q; lte: (c: string, v: number) => Q }>(q: Q) =>
      Number.isFinite(w) ? q.gte("rating", level - w).lte("rating", level + w) : q;

    const { count, error } = await inWindow(
      db.from("puzzles").select("id", { count: "exact", head: true }).contains("labels", o.puzzleLabels),
    );
    if (error) throw new Error(`Could not count puzzles: ${error.message}`);
    const total = count ?? 0;

    // Puzzle ids are random strings, so a slice in id order is a random sample.
    const offsets = sliceOffsets(total, random);
    for (const offset of offsets) {
      const { data, error: readErr } = await inWindow(
        db.from("puzzles").select("id, fen, moves, rating, themes, labels").contains("labels", o.puzzleLabels),
      ).order("id").range(offset, offset + SLICE - 1);
      if (readErr) throw new Error(`Could not read puzzles: ${readErr.message}`);
      for (const row of data as PuzzleDbRow[]) if (!skip.has(row.id)) pool.set(row.id, row);
      if (pool.size >= o.count) break;
    }
    if (pool.size >= o.count) break;
  }

  return shuffle([...pool.values()], random).slice(0, o.count).map((r) => ({
    id: r.id, fen: r.fen, moves: r.moves.split(" ").filter(Boolean), rating: r.rating, themes: r.themes, labels: r.labels,
  }));
}

/**
 * Where to read in a window of `total` puzzles: every slice when there are few, otherwise
 * SLICES_PER_WINDOW consecutive slices from a random start (wrapping round to the beginning).
 */
export function sliceOffsets(total: number, random: () => number): number[] {
  if (total <= 0) return [];
  const slices = Math.ceil(total / SLICE);
  if (slices <= SLICES_PER_WINDOW) return Array.from({ length: slices }, (_, i) => i * SLICE);
  const start = Math.min(slices - 1, Math.floor(random() * slices));
  return Array.from({ length: SLICES_PER_WINDOW }, (_, i) => ((start + i) % slices) * SLICE);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
