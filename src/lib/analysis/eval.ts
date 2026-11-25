// Engine scores and winning chances (SPEC.md -> "Game analysis pipeline" and "Scoring method").
//
// Mistakes are measured as a drop in winning chance, not in raw engine points: going from
// +9 to +6 hardly changes your chances, but going from +1 to -2 throws the game away.

/** A score as the engine reports it, from the point of view of the side to move. */
export type Score = { cp: number } | { mate: number };

/**
 * The engine settings, pinned so a change in a score reflects the user's play, not the engine.
 * Changing any of these (or the analysis method) means bumping ANALYSIS_VERSION, which makes
 * the job re-analyse every game the same way.
 */
export const ENGINE = {
  name: "Stockfish 17.1",
  release: "sf_17.1",
  nodes: 300_000, // search budget per position: about depth 20, ~0.4 s on one core
  threads: 1, // one thread + a fixed node count = the same result every time
  hashMb: 64,
} as const;

/** Bump when the engine settings or the way mistakes are found and tagged changes. */
export const ANALYSIS_VERSION = 1;

/**
 * A move is a mistake when it lowers the player's chance of winning by at least 10
 * percentage points. This is Lichess's "mistake" level (0.2 on its -1..1 scale); smaller
 * slips (inaccuracies) are ignored.
 */
export const MISTAKE_THRESHOLD = 0.1;

/** Lichess's winning-chance curve (https://github.com/lichess-org/lila/pull/11148). */
const MULTIPLIER = -0.00368208;

/** Chance of winning from 0 to 1 (0.5 = level) for the side the score belongs to. */
export function winProbability(score: Score): number {
  if ("mate" in score) return score.mate > 0 ? 1 : 0; // mate 0 = already checkmated
  return 1 / (1 + Math.exp(MULTIPLIER * score.cp));
}

/** The same position seen by the other player. */
export function flip(score: Score): Score {
  return "mate" in score ? { mate: -score.mate } : { cp: -score.cp };
}

/** Centipawns, with forced mates counted as a large number (for thresholds and sorting). */
export function centipawns(score: Score): number {
  if ("mate" in score) return score.mate > 0 ? 10_000 - score.mate : -10_000 - score.mate;
  return score.cp;
}

/** "+1.25", "-0.40", "#3", "#-2". */
export function formatScore(score: Score): string {
  if ("mate" in score) return `#${score.mate}`;
  const pawns = score.cp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

/** Splits a score into the two database columns. */
export function scoreColumns(score: Score): { cp: number | null; mate: number | null } {
  return "mate" in score ? { cp: null, mate: score.mate } : { cp: score.cp, mate: null };
}
