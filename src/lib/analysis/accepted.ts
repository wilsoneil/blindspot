// "Find the move" positions from the user's own games (SPEC.md -> "Training modes").
// For each stored mistake, Stockfish's top few moves in the position before it decide which
// answers are accepted: the best move, and any other that loses little winning chance
// against it. Pure functions; the engine runs in scripts/find-moves.ts.

import { winProbability, type Score } from "./eval";

/** How many top moves Stockfish lists for each position. */
export const TOP_MOVES = 5;
/** A move is accepted when it is within this much winning chance of the best (0..1). */
export const ACCEPT_MARGIN = 0.03;
/** A gap this big (in winning chance) to the first rejected move is as subtle as it gets. */
const FULL_GAP = 0.3;
/** Bump when the method changes, so every position is worked out again. */
export const POSITIONS_VERSION = 1;

export interface TopMove {
  move: string; // UCI
  score: Score; // from the side to move
}

/** Reads one MultiPV "info" line: the line number, its first move and score. Null for anything else. */
export function parseMultiPv(line: string): { multipv: number; depth: number; move: TopMove } | null {
  const t = line.split(/\s+/);
  if (t[0] !== "info") return null;
  const at = (k: string) => t.indexOf(k);
  const s = at("score");
  const pv = at("pv");
  if (s < 0 || pv < 0 || !t[pv + 1]) return null;
  if (t[s + 3] === "lowerbound" || t[s + 3] === "upperbound") return null;
  const value = Number(t[s + 2]);
  if (!Number.isFinite(value)) return null;
  const multipv = at("multipv") >= 0 ? Number(t[at("multipv") + 1]) : 1;
  const depth = at("depth") >= 0 ? Number(t[at("depth") + 1]) : 0;
  return { multipv, depth, move: { move: t[pv + 1], score: t[s + 1] === "mate" ? { mate: value } : { cp: value } } };
}

export interface AcceptedMoves {
  accepted: string[];
  /** 0 (many good moves, or little at stake) to 1 (one move, and everything else loses badly). */
  subtlety: number;
}

/**
 * The accepted moves and how subtle the position is, from the engine's top moves (best first).
 * When every listed move is accepted, the gap to the next one is unknown, so it counts as small.
 */
export function acceptedMoves(top: TopMove[]): AcceptedMoves {
  if (top.length === 0) return { accepted: [], subtlety: 0 };
  const best = winProbability(top[0].score);
  const accepted = top.filter((m) => best - winProbability(m.score) <= ACCEPT_MARGIN).map((m) => m.move);
  const firstRejected = top.find((m) => best - winProbability(m.score) > ACCEPT_MARGIN);
  const gap = firstRejected ? best - winProbability(firstRejected.score) : 0;
  const fewer = accepted.length === 1 ? 1 : accepted.length === 2 ? 0.75 : 0.5;
  return { accepted, subtlety: Math.round(1000 * fewer * Math.min(1, gap / FULL_GAP)) / 1000 };
}

/**
 * A stand-in puzzle rating for a position, so the mixed modes can order it among Lichess
 * puzzles: from 400 below the user's level (obvious) to 400 above (subtle).
 */
export function approxRating(level: number, subtlety: number): number {
  return Math.round(level - 400 + 800 * subtlety);
}
