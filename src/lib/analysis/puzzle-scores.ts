// Puzzle performance per weakness label, for the profile blend (SPEC.md -> "Scoring method").
// Pure calculation. On the game score's scale: 1 = the user's average for that family of
// labels, 2 = twice as many puzzle failures as their rating predicts, relative to the family.
//
//   1. For each first attempt at a Lichess puzzle, the rating predicts a chance of solving it
//      (from the Blindspot rating just before the attempt). A failure or slow solve is a miss.
//   2. Per label: misses against expected misses, weighted by recency (same half-life as games).
//   3. Compared with the family's overall ratio, and pulled towards it for small samples.

import { LABELS } from "../labels";
import { expectedScore, replay, type RatedAttempt, START } from "../training/rating";

export interface PuzzleAttemptForScore extends RatedAttempt {
  labels: string[]; // puzzle-store labels, e.g. "fork", "rookEndgame"
  attemptedAt: string;
}

/** How hard small samples are pulled towards the family's average (in expected misses). */
export const PRIOR_EXPECTED_MISSES = 3;
/** Attempts a label needs before its puzzle score is used at all. */
export const MIN_ATTEMPTS = 5;

const LABEL = new Map(LABELS.map((l) => [l.id, l]));

/** Profile keys a puzzle-store label speaks for: both sides of a tactic, else the label itself. */
function keysFor(labelId: string): string[] {
  const l = LABEL.get(labelId);
  if (!l) return [];
  return l.missedAllowed ? [`${l.id}:missed`, `${l.id}:allowed`] : [l.id];
}

export function puzzleScores(
  attempts: PuzzleAttemptForScore[], o: { halfLifeDays: number; now: Date },
): Map<string, number> {
  const history = replay(attempts);
  const perLabel = new Map<string, { miss: number; expected: number; n: number }>();
  attempts.forEach((a, i) => {
    const before = i === 0 ? START.rating : history[i - 1].rating;
    const ageDays = Math.max(0, (o.now.getTime() - new Date(a.attemptedAt).getTime()) / 86_400_000);
    const w = Math.pow(0.5, ageDays / o.halfLifeDays);
    const expectedMiss = 1 - expectedScore(before, a.puzzleRating);
    for (const id of new Set(a.labels)) {
      if (!LABEL.has(id)) continue;
      const s = perLabel.get(id) ?? perLabel.set(id, { miss: 0, expected: 0, n: 0 }).get(id)!;
      s.miss += w * (a.fullySolved ? 0 : 1);
      s.expected += w * expectedMiss;
      s.n++;
    }
  });

  const family = new Map<string, { miss: number; expected: number }>();
  for (const [id, s] of perLabel) {
    const f = LABEL.get(id)!.family;
    const t = family.get(f) ?? family.set(f, { miss: 0, expected: 0 }).get(f)!;
    t.miss += s.miss;
    t.expected += s.expected;
  }

  const out = new Map<string, number>();
  for (const [id, s] of perLabel) {
    if (s.n < MIN_ATTEMPTS) continue;
    const f = family.get(LABEL.get(id)!.family)!;
    if (f.expected <= 0 || f.miss <= 0) continue; // nothing to compare against yet
    const familyRatio = f.miss / f.expected;
    const ratio = (s.miss + PRIOR_EXPECTED_MISSES * familyRatio) / (s.expected + PRIOR_EXPECTED_MISSES);
    for (const key of keysFor(id)) out.set(key, ratio / familyRatio);
  }
  return out;
}
