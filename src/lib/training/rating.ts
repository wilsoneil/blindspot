// The Blindspot rating (SPEC.md -> "Progress and headline metrics"): one Glicko-2 rating
// over all rated Lichess puzzles attempted in the app, first attempts only. A puzzle counts
// as a win only when it was solved correctly within its target time, so the rating only
// rises for those. Calculated from Phase 3 (it sets the puzzle level), shown from Phase 4.
//
// It is worked out by replaying the user's first attempts in order, each against the
// puzzle's rating at the time (puzzle_attempts.puzzle_rating), so nothing extra is stored
// and the history for the Phase 4 charts can be rebuilt the same way.

import type { Db } from "../db";

export interface Glicko {
  rating: number;
  rd: number;
  vol: number;
}

/** Glicko-2 starting values and system constant (Glickman's suggested defaults). */
export const START: Glicko = { rating: 1500, rd: 350, vol: 0.06 };
export const TAU = 0.5;
/** Lowest RD, as Lichess does, so the rating keeps responding after many puzzles. */
export const MIN_RD = 45;
/** Lichess puzzles in the store have settled ratings; this stands in for their deviation. */
export const PUZZLE_RD = 80;

const SCALE = 173.7178;

/**
 * One Glicko-2 rating period against some opponents (Glickman, "Example of the Glicko-2
 * system", 2013). score: 1 = win, 0 = loss.
 */
export function glicko2(player: Glicko, games: { rating: number; rd: number; score: number }[], tau = TAU): Glicko {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  if (games.length === 0) {
    const phiStar = Math.sqrt(phi * phi + player.vol * player.vol);
    return { rating: player.rating, rd: Math.min(START.rd, phiStar * SCALE), vol: player.vol };
  }
  const g = (p: number) => 1 / Math.sqrt(1 + (3 * p * p) / (Math.PI * Math.PI));
  const opp = games.map((o) => {
    const muJ = (o.rating - 1500) / SCALE;
    const gJ = g(o.rd / SCALE);
    return { gJ, e: 1 / (1 + Math.exp(-gJ * (mu - muJ))), s: o.score };
  });
  const v = 1 / opp.reduce((sum, o) => sum + o.gJ * o.gJ * o.e * (1 - o.e), 0);
  const delta = v * opp.reduce((sum, o) => sum + o.gJ * (o.s - o.e), 0);

  // New volatility (Illinois algorithm).
  const a = Math.log(player.vol * player.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const vol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * opp.reduce((sum, o) => sum + o.gJ * (o.s - o.e), 0);
  return { rating: muNew * SCALE + 1500, rd: phiNew * SCALE, vol };
}

/** The chance of solving a puzzle at a given rating (the Glicko-2 expected score). */
export function expectedScore(rating: number, puzzleRating: number): number {
  const phi = PUZZLE_RD / SCALE;
  const g = 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
  return 1 / (1 + Math.exp((-g * (rating - puzzleRating)) / SCALE));
}

export interface RatedAttempt {
  puzzleRating: number;
  /** Correct within target time. */
  fullySolved: boolean;
}

/** The rating after one attempt (its own rating period, as on Lichess). */
export function rateAttempt(r: Glicko, a: RatedAttempt): Glicko {
  const next = glicko2(r, [{ rating: a.puzzleRating, rd: PUZZLE_RD, score: a.fullySolved ? 1 : 0 }]);
  // Never rises on a failed or slow puzzle (guards against rounding), and RD has a floor.
  return { rating: a.fullySolved ? next.rating : Math.min(next.rating, r.rating), rd: Math.max(MIN_RD, next.rd), vol: next.vol };
}

/** The rating after each attempt in turn. */
export function replay(attempts: RatedAttempt[], start: Glicko = START): Glicko[] {
  const out: Glicko[] = [];
  let r = start;
  for (const a of attempts) {
    r = rateAttempt(r, a);
    out.push(r);
  }
  return out;
}

const PAGE = 1000;

/** The user's rated first attempts, oldest first. */
export async function loadRatedAttempts(db: Pick<Db, "from">, userId: string): Promise<RatedAttempt[]> {
  const out: RatedAttempt[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("puzzle_attempts")
      .select("puzzle_rating, correct, solve_ms, target_ms")
      .eq("user_id", userId).eq("first_attempt", true).not("puzzle_id", "is", null)
      .order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read attempts for the rating: ${error.message}`);
    const rows = data as { puzzle_rating: number; correct: boolean; solve_ms: number; target_ms: number }[];
    for (const r of rows) out.push({ puzzleRating: r.puzzle_rating, fullySolved: r.correct && r.solve_ms <= r.target_ms });
    if (rows.length < PAGE) return out;
  }
}

/** The user's current Blindspot rating. */
export async function currentRating(db: Pick<Db, "from">, userId: string): Promise<Glicko> {
  const history = replay(await loadRatedAttempts(db, userId));
  return history.at(-1) ?? START;
}

/** The level puzzles are chosen around: the rating, rounded. */
export async function puzzleLevel(db: Pick<Db, "from">, userId: string): Promise<number> {
  return Math.round((await currentRating(db, userId)).rating);
}
