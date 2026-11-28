// Ratings for "find the move" positions from the user's own games (SPEC.md -> "Training
// modes"). Positions have no Lichess rating, so each gets a stand-in from how subtle its best
// move is. At first that is a fixed rule (approxRating: 400 below the user's level for an
// obvious move to 400 above for a subtle one). Once there are enough first attempts at own
// positions, the rule is replaced by one fitted to the user's results: a position's rating is
// a + b × subtlety, with a and b chosen so the Glicko-2 expected score against the user's
// Blindspot rating at the time best matches how often positions like it were solved.
// Nothing is stored: like the Blindspot rating, it is recalculated from the attempts.

import { approxRating } from "../analysis/accepted";
import type { Db } from "../db";
import { readAll } from "../read-all";
import { expectedScore, isFullySolved, PUZZLE_SLOPE, rateAttempt, START, type Glicko } from "./rating";

/** First attempts at own positions needed before the fitted rule replaces the fixed one. */
export const MIN_CALIBRATION_ATTEMPTS = 100;
/** Own-position attempts made before this many puzzle attempts are left out: the rating was still settling. */
export const MIN_PUZZLES_BEFORE = 20;
/** How far the fitted slope may go: never harder for an obvious move than a subtle one, and no steeper than twice the fixed rule. */
const MAX_SLOPE = 1600;

/** The fitted rule: rating = a + b × subtlety. */
export interface PositionCalibration {
  a: number;
  b: number;
  /** How many attempts it was fitted from. */
  attempts: number;
}

/** One first attempt at an own position. */
export interface PositionAttempt {
  subtlety: number;
  /** The user's Blindspot rating just before the attempt. */
  rating: number;
  /** Correct within target time, as for the Blindspot rating. */
  fullySolved: boolean;
}

/** The stand-in rating for a position: the fitted rule once there is one, else the fixed rule. */
export function positionRating(level: number, subtlety: number | null, calibration: PositionCalibration | null): number {
  const s = subtlety ?? 0.5;
  return calibration ? Math.round(calibration.a + calibration.b * s) : approxRating(level, s);
}

/** The slope of the expected score per rating point (Glicko-2, against a puzzle). */
const K = PUZZLE_SLOPE;

/**
 * Fits a and b by maximum likelihood (Newton's method), pulled gently towards the fixed rule
 * so a short or one-sided record (every position solved) can't run off to extremes.
 * Returns null below MIN_CALIBRATION_ATTEMPTS.
 */
export function fitCalibration(attempts: PositionAttempt[]): PositionCalibration | null {
  const n = attempts.length;
  if (n < MIN_CALIBRATION_ATTEMPTS) return null;
  const meanRating = attempts.reduce((sum, x) => sum + x.rating, 0) / n;
  // Prior: the fixed rule at the average rating, a within about ±200, b within about ±400.
  const prior = { a: meanRating - 400, b: 800, sa: 200, sb: 400 };
  let a = prior.a;
  let b = prior.b;
  for (let iter = 0; iter < 50; iter++) {
    // Log-likelihood of y given p = σ(K (rating − a − b s)); gradient and Hessian in (a, b).
    let ga = -(a - prior.a) / prior.sa ** 2;
    let gb = -(b - prior.b) / prior.sb ** 2;
    let haa = -1 / prior.sa ** 2;
    let hbb = -1 / prior.sb ** 2;
    let hab = 0;
    for (const x of attempts) {
      const p = 1 / (1 + Math.exp(-K * (x.rating - a - b * x.subtlety)));
      const r = (x.fullySolved ? 1 : 0) - p;
      ga -= K * r;
      gb -= K * r * x.subtlety;
      const w = K * K * p * (1 - p);
      haa -= w;
      hab -= w * x.subtlety;
      hbb -= w * x.subtlety * x.subtlety;
    }
    const det = haa * hbb - hab * hab;
    if (!(det > 0)) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) < 0.01 && Math.abs(db) < 0.01) break;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { a, b: Math.min(MAX_SLOPE, Math.max(0, b)), attempts: n };
}

/**
 * The share of attempts a rule expects to be solved, for checking it against the real share.
 * The fixed rule is applied at the rating each attempt was made at.
 */
export function expectedSolved(attempts: PositionAttempt[], calibration: PositionCalibration | null): number {
  if (attempts.length === 0) return 0;
  return attempts.reduce((sum, x) => sum + expectedScore(x.rating, positionRating(x.rating, x.subtlety, calibration)), 0)
    / attempts.length;
}

interface AttemptRow {
  puzzle_id: string | null;
  puzzle_rating: number | null;
  correct: boolean;
  solve_ms: number;
  target_ms: number;
  mistakes: { subtlety: number | null } | null;
}

/**
 * Every first attempt, oldest first, read once: the Blindspot rating replayed over the
 * puzzles, and each own-position attempt with the rating just before it.
 */
export async function loadTrainingHistory(db: Pick<Db, "from">, userId: string): Promise<{
  rating: Glicko; positions: PositionAttempt[];
}> {
  const rows = await readAll<AttemptRow>((from, to) =>
    db.from("puzzle_attempts")
      .select("puzzle_id, puzzle_rating, correct, solve_ms, target_ms, mistakes(subtlety)")
      .eq("user_id", userId).eq("first_attempt", true)
      .order("id").range(from, to), "read attempts");
  let r = START;
  let puzzles = 0;
  const positions: PositionAttempt[] = [];
  for (const row of rows) {
    const fullySolved = isFullySolved(row);
    if (row.puzzle_id !== null && row.puzzle_rating !== null) {
      r = rateAttempt(r, { puzzleRating: row.puzzle_rating, fullySolved });
      puzzles++;
    } else if (row.mistakes && puzzles >= MIN_PUZZLES_BEFORE) {
      positions.push({ subtlety: row.mistakes.subtlety ?? 0.5, rating: r.rating, fullySolved });
    }
  }
  return { rating: r, positions };
}

/** The puzzle level and the own-position rule, for choosing what to train. */
export interface TrainingLevel {
  level: number;
  calibration: PositionCalibration | null;
}

export async function trainingLevel(db: Pick<Db, "from">, userId: string): Promise<TrainingLevel> {
  const { rating, positions } = await loadTrainingHistory(db, userId);
  return { level: Math.round(rating.rating), calibration: fitCalibration(positions) };
}
