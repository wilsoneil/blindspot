// One way to get training items for any weakness: Lichess puzzles, or "find the move"
// positions from the user's own games for labels Lichess puzzles can't train.

import type { Db } from "../db";
import { openingCandidates } from "./openings";
import { selectPositions } from "./positions";
import { attemptedPuzzleIds, selectPuzzles, trainingSource, type TrainingPuzzle } from "./select";

export type Weakness =
  | { key: string; kind: "puzzles"; puzzleLabels: string[] }
  | { key: string; kind: "ownGames"; labelKeys: string[] }
  /** OpeningTags sets to try in turn, most specific first (src/lib/training/openings.ts). */
  | { key: string; kind: "opening"; candidates: string[][] };

/** A weakness from its profile key ("fork:missed", "pawnDecisions+phaseTransition"), or null if it can't be trained yet. */
export function weaknessFromKey(key: string): Weakness | null {
  if (key.startsWith("opening:")) {
    const candidates = openingCandidates(key);
    return candidates.length ? { key, kind: "opening", candidates } : null;
  }
  const labels = key.split("+");
  const s = trainingSource(labels);
  if (s.kind === "puzzles") return { key, kind: "puzzles", puzzleLabels: s.puzzleLabels };
  if (s.kind === "ownGames") return { key, kind: "ownGames", labelKeys: labels };
  return null;
}

export interface ItemSelect {
  userId: string;
  count: number;
  level: number;
  /** Aim at this rating instead of the level (the mixed modes' ladder). */
  near?: number;
  attempted?: Set<string>;
  exclude?: Iterable<string>;
  random?: () => number;
}

export async function selectFor(db: Pick<Db, "from">, w: Weakness, o: ItemSelect): Promise<TrainingPuzzle[]> {
  if (w.kind === "opening") {
    // The most specific tags first; fill up from broader ones if they run short.
    const out: TrainingPuzzle[] = [];
    const exclude = new Set(o.exclude ?? []);
    const attempted = o.attempted ?? await attemptedPuzzleIds(db, o.userId);
    for (const tags of w.candidates) {
      const got = await selectPuzzles(db, {
        userId: o.userId, puzzleLabels: [], openingTags: tags, count: o.count - out.length,
        level: Math.round(o.near ?? o.level), attempted, exclude, random: o.random,
      });
      for (const p of got) exclude.add(p.id);
      out.push(...got);
      if (out.length >= o.count) break;
    }
    return out;
  }
  if (w.kind === "puzzles") {
    return selectPuzzles(db, {
      userId: o.userId, puzzleLabels: w.puzzleLabels, count: o.count, level: Math.round(o.near ?? o.level),
      attempted: o.attempted, exclude: o.exclude, random: o.random,
    });
  }
  return selectPositions(db, {
    userId: o.userId, labelKeys: w.labelKeys, count: o.count, level: o.level, near: o.near, exclude: o.exclude, random: o.random,
  });
}
