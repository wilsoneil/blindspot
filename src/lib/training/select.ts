// Chooses the puzzles that train one weakness (SPEC.md -> "Training modes").
// Server-only: reads the puzzle store and the user's attempts.
//
// A weakness is a single label key ("fork:missed") or a pair ("fork:missed" + "rookEndgame").
// Lichess puzzles train it when every label maps to a puzzle theme; a pair needs puzzles
// carrying both. Positional labels (no Lichess theme) are trained with the user's own
// positions (step 10), and openings once they are mapped to Lichess tags (step 11).

import type { Db } from "../db";
import { labelForKey, puzzleLabelForKey } from "../labels";
import { readAll } from "../read-all";

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

export interface TrainingPuzzle {
  id: string;
  fen: string; // position before the opponent's setup move
  moves: string[]; // UCI; moves[0] is the opponent's setup move, then the solution
  rating: number;
  themes: string[];
  labels: string[];
  /** Set for a "find the move" position from the user's own game (src/lib/training/positions.ts). */
  position?: PositionDetails;
}

export interface PositionDetails {
  mistakeId: number;
  /** Any of these solves it; `fen` is the position to move in and `moves` is empty. */
  accepted: string[];
  /** What happened in the game, shown afterwards. */
  playedSan: string;
  playedUci: string;
  /** The opponent's best reply line after the move played (UCI), to see why it was a mistake. */
  refutation: string[];
  bestSan: string;
  playedAt: string;
}

export interface PuzzleDbRow {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  themes: string[];
  labels: string[];
}

/** The puzzle columns a TrainingPuzzle is built from. */
export const PUZZLE_COLUMNS = "id, fen, moves, rating, themes, labels";

export function puzzleFromRow(r: PuzzleDbRow): TrainingPuzzle {
  return { id: r.id, fen: r.fen, moves: r.moves.split(" ").filter(Boolean), rating: r.rating, themes: r.themes, labels: r.labels };
}

export interface SelectOptions {
  userId: string;
  /** Puzzle-store labels the puzzles must all carry (from trainingSource). */
  puzzleLabels: string[];
  /** Lichess OpeningTags: the puzzles must carry at least one (opening weaknesses). */
  openingTags?: string[];
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

/** The ids in one column of the user's attempts (any mode). */
async function attemptedIds<T>(db: Pick<Db, "from">, userId: string, column: "puzzle_id" | "mistake_id"): Promise<Set<T>> {
  const rows = await readAll<Record<string, T>>((from, to) =>
    db.from("puzzle_attempts").select(column).eq("user_id", userId).not(column, "is", null)
      .order("id").range(from, to), "read past attempts");
  return new Set(rows.map((r) => r[column]));
}

/** Puzzle ids the user has already attempted (any mode). */
export const attemptedPuzzleIds = (db: Pick<Db, "from">, userId: string) => attemptedIds<string>(db, userId, "puzzle_id");

/** Mistake ids the user has already trained as own positions. */
export const attemptedMistakeIds = (db: Pick<Db, "from">, userId: string) => attemptedIds<number>(db, userId, "mistake_id");

/**
 * Unseen puzzles carrying all the given labels, as close to the user's level as possible:
 * the narrowest rating window with enough of them, in random order.
 */
export async function selectPuzzles(db: Pick<Db, "from">, o: SelectOptions): Promise<TrainingPuzzle[]> {
  const tags = o.openingTags ?? [];
  if ((o.puzzleLabels.length === 0 && tags.length === 0) || o.count <= 0) return [];
  const level = o.level ?? DEFAULT_LEVEL;
  const random = o.random ?? Math.random;
  const skip = new Set(o.attempted ?? await attemptedPuzzleIds(db, o.userId));
  for (const id of o.exclude ?? []) skip.add(id);

  const pool = new Map<string, PuzzleDbRow>();
  for (const w of RATING_WINDOWS) {
    type Filterable<Q> = {
      gte: (c: string, v: number | string) => Q; lte: (c: string, v: number) => Q;
      gt: (c: string, v: string) => Q; lt: (c: string, v: string) => Q;
      contains: (c: string, v: string[]) => Q; overlaps: (c: string, v: string[]) => Q;
    };
    const inWindow = <Q extends Filterable<Q>>(q: Q) => {
      let f = Number.isFinite(w) ? q.gte("rating", level - w).lte("rating", level + w) : q;
      if (o.puzzleLabels.length) f = f.contains("labels", o.puzzleLabels);
      if (tags.length) f = f.overlaps("opening_tags", tags);
      return f;
    };

    // Puzzle ids are random strings, so reading in id order from a random id is a random
    // sample: from there to the end, then round from the beginning (no count needed).
    const start = randomId(random);
    let cursor: string | null = null;
    let wrapped = false;
    for (let i = 0; i < SLICES_PER_WINDOW; i++) {
      let q = inWindow(db.from("puzzles").select(PUZZLE_COLUMNS));
      if (cursor !== null) q = q.gt("id", cursor);
      q = wrapped ? q.lt("id", start) : cursor === null ? q.gte("id", start) : q;
      const { data, error: readErr } = await q.order("id").limit(SLICE);
      if (readErr) throw new Error(`Could not read puzzles: ${readErr.message}`);
      const rows = data as PuzzleDbRow[];
      for (const row of rows) if (!skip.has(row.id)) pool.set(row.id, row);
      if (pool.size >= o.count) break;
      if (rows.length < SLICE) {
        if (wrapped) break; // read the whole window
        wrapped = true;
        cursor = null;
      } else {
        cursor = rows[rows.length - 1].id;
      }
    }
    if (pool.size >= o.count) break;
  }

  return shuffled([...pool.values()], random).slice(0, o.count).map(puzzleFromRow);
}

const ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A random place among the puzzle ids (Lichess ids are five letters and digits). */
export function randomId(random: () => number): string {
  return Array.from({ length: 5 }, () => ID_CHARS[Math.floor(random() * ID_CHARS.length) % ID_CHARS.length]).join("");
}

/** Shuffles a copy (Fisher-Yates). */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
