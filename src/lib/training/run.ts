// Puzzles for the mixed modes, Rush and Survival (SPEC.md -> "Training modes"): all the
// top weaknesses shuffled together, with rising difficulty.
//
// A run is a ladder: puzzle i aims at the ladder's start below the user's level plus its step
// per puzzle (LADDERS: Rush starts lower and climbs slower, as it trains speed). Puzzles come in chunks of CHUNK; each chunk takes PER_WEAKNESS puzzles from
// each of the next few weaknesses in turn, so every chunk mixes weaknesses. Up to
// REVIEWS_PER_CHUNK of each chunk are earlier misses due for review (the spaced-repetition
// queue), each placed in the chunk matching its own difficulty (placeReviews).

import type { Db } from "../db";
import type { PositionCalibration } from "./position-rating";
import { positionFromMistake } from "./positions";
import { dueReviews } from "./review";
import { attemptedPuzzleIds, type TrainingPuzzle } from "./select";
import { selectFor, weaknessFromKey, type Weakness } from "./sources";

export type RunMode = "rush" | "survival";
export interface Ladder { start: number; step: number }
/** Rush trains speed: easy at first, climbing slowly. Survival climbs faster, reaching the user's level after about 33 puzzles. */
export const LADDERS: Record<RunMode, Ladder> = {
  rush: { start: -600, step: 10 },
  survival: { start: -500, step: 15 },
};
export const CHUNK = 6;
const PER_WEAKNESS = 2;
/** At most a third of a run is reviews, so a long review queue never crowds out new puzzles. */
export const REVIEWS_PER_CHUNK = 2;
/** How many due reviews a run looks through (all of them, in practice). */
export const MAX_DUE_REVIEWS = 500;

export type RunPuzzle = TrainingPuzzle & { review?: boolean };

/** Puzzles and own positions due for review now (not already in this run), oldest due first. */
export async function loadDueReviews(
  db: Pick<Db, "from">, userId: string, o: { limit: number; level: number; calibration?: PositionCalibration | null; exclude?: Set<string>; now?: Date },
): Promise<RunPuzzle[]> {
  const due = (await dueReviews(db, userId, o.limit, o.now))
    .filter((r) => !o.exclude?.has("puzzleId" in r ? r.puzzleId : `m${r.mistakeId}`));
  const puzzleIds = due.flatMap((r) => ("puzzleId" in r ? [r.puzzleId] : []));
  const mistakeIds = due.flatMap((r) => ("mistakeId" in r ? [r.mistakeId] : []));
  const out: RunPuzzle[] = [];
  const order = new Map(due.map((r, i) => ["puzzleId" in r ? r.puzzleId : `m${r.mistakeId}`, i]));
  if (puzzleIds.length) {
    const { data, error } = await db.from("puzzles").select("id, fen, moves, rating, themes, labels").in("id", puzzleIds);
    if (error) throw new Error(`Could not read review puzzles: ${error.message}`);
    for (const r of data as { id: string; fen: string; moves: string; rating: number; themes: string[]; labels: string[] }[]) {
      out.push({ ...r, moves: r.moves.split(" ").filter(Boolean), review: true });
    }
  }
  if (mistakeIds.length) {
    const { data, error } = await db.from("mistakes")
      .select("id, fen, labels, accepted_moves, subtlety, played_san, played_uci, refutation, best_san, played_at")
      .eq("user_id", userId).in("id", mistakeIds);
    if (error) throw new Error(`Could not read review positions: ${error.message}`);
    for (const m of data as Parameters<typeof positionFromMistake>[0][]) {
      if (m.accepted_moves?.length) out.push({ ...positionFromMistake(m, o.level, o.calibration), review: true });
    }
  }
  return out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** The rating the ladder aims at for puzzle number i (from 0). */
export function ladderRating(level: number, i: number, ladder: Ladder = LADDERS.survival): number {
  return level + ladder.start + ladder.step * i;
}

/** Which weaknesses (indexes into the list) fill chunk number c. */
export function chunkWeaknesses(weaknessCount: number, chunk: number): number[] {
  if (weaknessCount === 0) return [];
  const perChunk = Math.min(weaknessCount, CHUNK / PER_WEAKNESS);
  return Array.from({ length: perChunk }, (_, j) => (chunk * perChunk + j) % weaknessCount);
}

export interface RunSelect {
  userId: string;
  /** The trainable top weaknesses, in a fixed (shuffled) order. */
  weaknesses: Weakness[];
  level: number;
  /** The fitted own-position rule, if any (position-rating.ts). */
  calibration?: PositionCalibration | null;
  /** Rush or Survival, for the ladder (default Survival). */
  mode?: RunMode;
  /** First chunk to fetch, and how many. */
  fromChunk: number;
  chunks: number;
  exclude?: Iterable<string>;
  random?: () => number;
  now?: Date;
}

/** The next chunks of a run, in ladder order (easiest first within each chunk). */
export async function selectRunPuzzles(db: Pick<Db, "from">, o: RunSelect): Promise<RunPuzzle[]> {
  if (o.weaknesses.length === 0) return [];
  const taken = new Set(o.exclude ?? []);
  // Every due review, so ones that fit this part of the ladder are found even behind a
  // backlog of harder ones the run hasn't reached. Read alongside the past attempts.
  const [attempted, reviews] = await Promise.all([
    attemptedPuzzleIds(db, o.userId),
    loadDueReviews(db, o.userId, { limit: MAX_DUE_REVIEWS, level: o.level, calibration: o.calibration, exclude: taken, now: o.now }),
  ]);
  const ladder = LADDERS[o.mode ?? "survival"];
  const byChunk = placeReviews(reviews, o.level, o.fromChunk, o.chunks, ladder);
  const out: RunPuzzle[] = [];
  for (let c = o.fromChunk; c < o.fromChunk + o.chunks; c++) {
    const centre = ladderRating(o.level, c * CHUNK + (CHUNK - 1) / 2, ladder);
    const chunkReviews = byChunk.get(c) ?? [];
    for (const r of chunkReviews) taken.add(r.id);
    const picks = await Promise.all(chunkWeaknesses(o.weaknesses.length, c).map((w) =>
      selectFor(db, o.weaknesses[w], {
        userId: o.userId, count: PER_WEAKNESS + 1, level: o.level, calibration: o.calibration, near: centre, attempted, exclude: taken, random: o.random,
      })));
    // Take them in turn from each weakness, so a short list doesn't crowd out the others.
    // The same puzzle can carry two weaknesses' labels: keep it once.
    const interleaved: TrainingPuzzle[] = [];
    for (let k = 0; k <= PER_WEAKNESS; k++) for (const p of picks) if (p[k]) interleaved.push(p[k]);
    const fresh: RunPuzzle[] = [];
    for (const p of interleaved) {
      if (fresh.length >= CHUNK - chunkReviews.length) break;
      if (taken.has(p.id)) continue;
      taken.add(p.id);
      fresh.push(p);
    }
    const chunk: RunPuzzle[] = [...chunkReviews, ...fresh].sort((a, b) => a.rating - b.rating);
    out.push(...chunk);
  }
  return out;
}

/** The chunk whose difficulty best matches a rating (never before `from`). */
export function chunkForRating(level: number, rating: number, from: number, ladder: Ladder = LADDERS.survival): number {
  const c = Math.round((rating - ladderRating(level, (CHUNK - 1) / 2, ladder)) / (ladder.step * CHUNK));
  return Math.max(from, c);
}

/**
 * Places reviews (oldest due first) in the chunks being fetched: each in the chunk matching
 * its rating (easier ones in the first), at most REVIEWS_PER_CHUNK per chunk, spilling into
 * the next chunk when one is full, so the oldest that fit get the places. Reviews harder
 * than every chunk fetched now wait for a later fetch.
 */
export function placeReviews(
  reviews: RunPuzzle[], level: number, from: number, chunks: number, ladder: Ladder = LADDERS.survival,
): Map<number, RunPuzzle[]> {
  const out = new Map<number, RunPuzzle[]>();
  for (const r of reviews) {
    for (let c = chunkForRating(level, r.rating, from, ladder); c < from + chunks; c++) {
      const list = out.get(c) ?? [];
      if (list.length < REVIEWS_PER_CHUNK) {
        out.set(c, [...list, r]);
        break;
      }
    }
  }
  return out;
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

/**
 * The top weaknesses a mixed mode draws on: those shown on the home page that can be trained
 * (Lichess puzzles, or positions from the user's own games).
 */
export function mixedWeaknesses(top: { key: string }[], shown: number): Weakness[] {
  return top.slice(0, shown).flatMap((w) => {
    const weakness = weaknessFromKey(w.key);
    return weakness ? [weakness] : [];
  });
}
