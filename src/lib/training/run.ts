// Puzzles for the mixed modes, Rush and Survival (SPEC.md -> "Training modes"): all the
// top weaknesses shuffled together, with rising difficulty.
//
// A run is a ladder: puzzle i aims at LADDER_START below the user's level plus LADDER_STEP
// per puzzle. Puzzles come in chunks of CHUNK; each chunk takes PER_WEAKNESS puzzles from
// each of the next few weaknesses in turn, so every chunk mixes weaknesses.

import type { Db } from "../db";
import { attemptedPuzzleIds, selectPuzzles, trainingSource, type TrainingPuzzle } from "./select";

export const LADDER_START = -300;
export const LADDER_STEP = 25;
export const CHUNK = 6;
const PER_WEAKNESS = 2;

/** The rating the ladder aims at for puzzle number i (from 0). */
export function ladderRating(level: number, i: number): number {
  return level + LADDER_START + LADDER_STEP * i;
}

/** Which weaknesses (indexes into the list) fill chunk number c. */
export function chunkWeaknesses(weaknessCount: number, chunk: number): number[] {
  if (weaknessCount === 0) return [];
  const perChunk = Math.min(weaknessCount, CHUNK / PER_WEAKNESS);
  return Array.from({ length: perChunk }, (_, j) => (chunk * perChunk + j) % weaknessCount);
}

export interface RunSelect {
  userId: string;
  /** Puzzle-store labels for each trainable top weakness, in a fixed (shuffled) order. */
  weaknesses: string[][];
  level: number;
  /** First chunk to fetch, and how many. */
  fromChunk: number;
  chunks: number;
  exclude?: Iterable<string>;
  random?: () => number;
}

/** The next chunks of a run, in ladder order (easiest first within each chunk). */
export async function selectRunPuzzles(db: Pick<Db, "from">, o: RunSelect): Promise<TrainingPuzzle[]> {
  if (o.weaknesses.length === 0) return [];
  const attempted = await attemptedPuzzleIds(db, o.userId);
  const taken = new Set(o.exclude ?? []);
  const out: TrainingPuzzle[] = [];
  for (let c = o.fromChunk; c < o.fromChunk + o.chunks; c++) {
    const centre = ladderRating(o.level, c * CHUNK + (CHUNK - 1) / 2);
    const picks = await Promise.all(chunkWeaknesses(o.weaknesses.length, c).map((w) =>
      selectPuzzles(db, {
        userId: o.userId, puzzleLabels: o.weaknesses[w], count: PER_WEAKNESS + 1, level: Math.round(centre),
        attempted, exclude: taken, random: o.random,
      })));
    // Take them in turn from each weakness, so a short list doesn't crowd out the others.
    // The same puzzle can carry two weaknesses' labels: keep it once.
    const interleaved: TrainingPuzzle[] = [];
    for (let k = 0; k <= PER_WEAKNESS; k++) for (const p of picks) if (p[k]) interleaved.push(p[k]);
    const chunk = interleaved
      .filter((p) => !taken.has(p.id) && (taken.add(p.id), true))
      .slice(0, CHUNK)
      .sort((a, b) => a.rating - b.rating);
    out.push(...chunk);
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

/** The top weaknesses a mixed mode draws on: those shown on the home page that Lichess puzzles train. */
export function mixedWeaknesses(top: { key: string; labels: string[] }[], shown: number): { key: string; puzzleLabels: string[] }[] {
  return top.slice(0, shown).flatMap((w) => {
    const s = trainingSource(w.labels);
    return s.kind === "puzzles" ? [{ key: w.key, puzzleLabels: s.puzzleLabels }] : [];
  });
}
