// Plays a Lichess puzzle: checks the user's moves against the solution
// (SPEC.md -> "Puzzle experience"). Pure chess logic, no board, so it runs in tests too.
//
// A Lichess puzzle's moves start with the opponent's setup move; then the user and the
// opponent alternate, and the solution always ends on a user move. As on Lichess, any move
// that gives checkmate solves the puzzle, even if it isn't the stored one.

import { Chess, type Square } from "chess.js";
import type { TargetTime } from "../settings";

export type Uci = string; // e.g. "e2e4", "e7e8q"

export type MoveResult =
  | { result: "correct"; reply: Uci } // right; the opponent answered with `reply`
  | { result: "solved" }
  | { result: "wrong" } // not the solution; the position is left as it was before the move
  | { result: "illegal" };

/** What the board needs from a puzzle or a "find the move" position. */
export interface BoardRun {
  readonly chess: Chess;
  readonly userColor: "white" | "black";
  readonly userMoves: number;
  /** The opponent's move before the user's first, if any (Lichess puzzles have one). */
  readonly setupMove: Uci | null;
  readonly solved: boolean;
  readonly fen: string;
  dests(): Map<Square, Square[]>;
  isPromotion(from: Square, to: Square): boolean;
  play(uci: Uci): MoveResult;
  expectedMove(): Uci | null;
}

function legalDests(chess: Chess): Map<Square, Square[]> {
  const out = new Map<Square, Square[]>();
  for (const m of chess.moves({ verbose: true })) out.set(m.from, [...(out.get(m.from) ?? []), m.to]);
  return out;
}

function tryMove(chess: Chess, uci: Uci) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null; // chess.js throws on an illegal move
  }
}

/**
 * A "find the move" position from the user's own game: one move to find, and any of the
 * accepted moves (worked out by Stockfish, src/lib/analysis/accepted.ts) solves it.
 */
export class FindMoveRun implements BoardRun {
  readonly chess: Chess;
  readonly userColor: "white" | "black";
  readonly userMoves = 1;
  readonly setupMove = null;
  private done = false;

  constructor(fen: string, private readonly accepted: Uci[]) {
    if (accepted.length === 0) throw new Error("This position has no accepted moves.");
    this.chess = new Chess(fen);
    this.userColor = this.chess.turn() === "w" ? "white" : "black";
  }

  get solved() {
    return this.done;
  }

  get fen() {
    return this.chess.fen();
  }

  dests() {
    return this.done ? new Map<Square, Square[]>() : legalDests(this.chess);
  }

  isPromotion(from: Square, to: Square) {
    return this.chess.get(from)?.type === "p" && (to[1] === "8" || to[1] === "1");
  }

  play(uci: Uci): MoveResult {
    if (this.done || !tryMove(this.chess, uci)) return { result: "illegal" };
    if (this.accepted.includes(uci)) {
      this.done = true;
      return { result: "solved" };
    }
    this.chess.undo();
    return { result: "wrong" };
  }

  expectedMove() {
    return this.done ? null : this.accepted[0];
  }
}

export class PuzzleRun implements BoardRun {
  readonly chess: Chess;
  readonly userColor: "white" | "black";
  /** Moves the user has to play to solve it. */
  readonly userMoves: number;
  private next = 1; // index in `moves` of the move expected from the user
  private done = false;

  constructor(fen: string, private readonly moves: Uci[]) {
    if (moves.length < 2 || moves.length % 2 !== 0) throw new Error("A puzzle needs a setup move and a solution ending on the user's move.");
    this.chess = new Chess(fen);
    const setup = this.apply(moves[0]);
    if (!setup) throw new Error(`The puzzle's setup move ${moves[0]} is illegal.`);
    this.userColor = this.chess.turn() === "w" ? "white" : "black";
    this.userMoves = moves.length / 2;
  }

  /** The opponent's setup move, for highlighting as the last move. */
  get setupMove(): Uci | null {
    return this.moves[0];
  }

  get solved(): boolean {
    return this.done;
  }

  get fen(): string {
    return this.chess.fen();
  }

  /** Legal moves from each square, in the form the board wants. */
  dests(): Map<Square, Square[]> {
    return this.done ? new Map<Square, Square[]>() : legalDests(this.chess);
  }

  /** Whether moving from `from` to `to` is a pawn reaching the last rank (so a piece must be chosen). */
  isPromotion(from: Square, to: Square): boolean {
    const piece = this.chess.get(from);
    return piece?.type === "p" && (to[1] === "8" || to[1] === "1");
  }

  /** The user plays a move. */
  play(uci: Uci): MoveResult {
    if (this.done) return { result: "illegal" };
    const expected = this.moves[this.next];
    const move = this.apply(uci);
    if (!move) return { result: "illegal" };
    if (this.chess.isCheckmate()) {
      this.done = true;
      return { result: "solved" };
    }
    if (uci !== expected) {
      this.chess.undo();
      return { result: "wrong" };
    }
    if (this.next === this.moves.length - 1) {
      this.done = true;
      return { result: "solved" };
    }
    const reply = this.moves[this.next + 1];
    this.apply(reply);
    this.next += 2;
    return { result: "correct", reply };
  }

  /** The move the solution expects next (for "reveal solution" and hints). */
  expectedMove(): Uci | null {
    return this.done ? null : this.moves[this.next];
  }

  private apply(uci: Uci) {
    return tryMove(this.chess, uci);
  }
}

/** Puzzles this far above the user's level get longer (SPEC.md -> "Target time"). */
export const HARD_PUZZLE_GAP = 200;
export const MS_PER_MOVE = 15_000;
const TARGET_FACTOR: Record<TargetTime, number> = { stricter: 0.75, normal: 1, looser: 1.5 };

/** Target solve time: 15 s per user move, +50% for hard puzzles, scaled by the setting. */
export function targetTimeMs(o: { userMoves: number; puzzleRating: number; level: number; setting: TargetTime }): number {
  const hard = o.puzzleRating >= o.level + HARD_PUZZLE_GAP ? 1.5 : 1;
  return Math.round(MS_PER_MOVE * o.userMoves * hard * TARGET_FACTOR[o.setting]);
}
