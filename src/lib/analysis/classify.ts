// The labels Blindspot computes itself (SPEC.md -> "Categories"): game phase, endgame type,
// move type and position state. Tactical motifs and mates come from the Lichess tagger.
//
// Each label also has a "situation": whether it could have happened at that move at all.
// A game "exposes" a label if the situation arose at any of the user's moves. That is what
// mistakes are divided by ("mistakes per game in which the situation arises").

import { Chess, type Move, type PieceSymbol } from "chess.js";
import { centipawns, type Score } from "./eval";
import type { Colour } from "./positions";

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

export type Phase = "phaseOpening" | "phaseTransition" | "phaseMiddlegame" | "phaseEndgame";

/** Endgame: at most 6 queens, rooks, bishops and knights left on the board in total (as Lichess divides games). */
export const ENDGAME_MAX_PIECES = 6;
/** The opening lasts until development is done, but at least until move 10 and at most until move 15. */
export const OPENING_MIN_MOVE = 10;
export const OPENING_MAX_MOVE = 15;
/** The transition (development done, before the middlegame proper) runs to move 20. */
export const TRANSITION_LAST_MOVE = 20;

const HOME_MINORS: Record<Colour, string[]> = {
  white: ["b1", "g1", "c1", "f1"],
  black: ["b8", "g8", "c8", "f8"],
};
const HOME_KING: Record<Colour, string> = { white: "e1", black: "e8" };

type Board = ReturnType<Chess["board"]>;

function pieceAt(board: Board, square: string) {
  const file = square.charCodeAt(0) - 97;
  const rank = 8 - Number(square[1]);
  return board[rank][file];
}

/**
 * Development is done when at most one of the player's knights and bishops is still on its
 * starting square and the king has left its starting square (usually by castling).
 */
export function developmentDone(board: Board, colour: Colour): boolean {
  const c = colour === "white" ? "w" : "b";
  const homeMinors = HOME_MINORS[colour].filter((sq) => {
    const p = pieceAt(board, sq);
    return p && p.color === c && (p.type === "n" || p.type === "b");
  }).length;
  const king = pieceAt(board, HOME_KING[colour]);
  const kingHome = !!king && king.type === "k" && king.color === c;
  return homeMinors <= 1 && !kingHome;
}

function pieceCount(board: Board): number {
  let n = 0;
  for (const row of board) for (const p of row) if (p && p.type !== "k" && p.type !== "p") n++;
  return n;
}

/** The phase of a position. `developed` = the player's development was done at this move or earlier. */
export function phaseOf(board: Board, moveNumber: number, developed: boolean): Phase {
  if (pieceCount(board) <= ENDGAME_MAX_PIECES) return "phaseEndgame";
  if (moveNumber < OPENING_MIN_MOVE) return "phaseOpening";
  if (!developed && moveNumber < OPENING_MAX_MOVE) return "phaseOpening";
  if (moveNumber <= TRANSITION_LAST_MOVE) return "phaseTransition";
  return "phaseMiddlegame";
}

// ---------------------------------------------------------------------------
// Endgame type (the same definitions as the Lichess tagger's endgame themes)
// ---------------------------------------------------------------------------

/** "rookEndgame" etc., or null if the position isn't one of the endgame types. */
export function endgameTypeOf(board: Board): string | null {
  const counts: Record<string, number> = { q: 0, r: 0, b: 0, n: 0, p: 0 };
  for (const row of board) for (const p of row) if (p && p.type !== "k") counts[p.type]++;
  const pieces = counts.q + counts.r + counts.b + counts.n;
  if (pieces === 0) return "pawnEndgame";
  const only = (t: PieceSymbol) => counts[t] > 0 && counts[t] === pieces;
  if (only("q")) return "queenEndgame";
  if (only("r")) return "rookEndgame";
  if (only("b")) return "bishopEndgame";
  if (only("n")) return "knightEndgame";
  if (counts.q === 1 && counts.r > 0 && counts.b + counts.n === 0) return "queenRookEndgame";
  return null;
}

// ---------------------------------------------------------------------------
// Position state (from the engine's evaluation before the move, from the user's side)
// ---------------------------------------------------------------------------

/** 1.5 pawns or more either way counts as a clear advantage. */
export const ADVANTAGE_CP = 150;

export function positionStateOf(evalBefore: Score): "converting" | "defending" | "balanced" {
  const cp = centipawns(evalBefore);
  if (cp >= ADVANTAGE_CP) return "converting";
  if (cp <= -ADVANTAGE_CP) return "defending";
  return "balanced";
}

// ---------------------------------------------------------------------------
// Move type
// ---------------------------------------------------------------------------

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Swapping a piece for one of the same value: knight or bishop for knight or bishop, rook for rook, queen for queen. */
export function isEqualTrade(m: Pick<Move, "piece" | "captured">): boolean {
  return !!m.captured && m.piece !== "p" && m.piece !== "k" && VALUE[m.piece] === VALUE[m.captured];
}

export interface MoveTypeInput {
  /** The legal moves in the position. */
  legal: Move[];
  played: Move;
  best: Move | null;
  /** The opponent's previous move, if any. */
  previous: { to: string; captured?: PieceSymbol } | null;
}

/** Move-type labels for a mistake: what kind of decision it was. */
export function moveTypesOf({ played, best, previous }: MoveTypeInput): string[] {
  const moves = best ? [played, best] : [played];
  const out: string[] = [];
  if (moves.some((m) => m.piece === "p")) out.push("pawnDecisions");
  if (previous?.captured && moves.some((m) => m.captured && m.to === previous.to)) out.push("recaptureChoice");
  if (moves.some(isEqualTrade)) out.push("tradeDecisions");
  return out;
}

/** Move-type situations: which kinds of decision were on offer at this move. */
export function moveTypeSituations({ legal, previous }: Pick<MoveTypeInput, "legal" | "previous">): string[] {
  const out: string[] = [];
  if (legal.some((m) => m.piece === "p")) out.push("pawnDecisions");
  if (previous?.captured && legal.some((m) => m.captured && m.to === previous.to)) out.push("recaptureChoice");
  if (legal.some(isEqualTrade)) out.push("tradeDecisions");
  return out;
}

/** Makes a chess.js move object from a UCI move, or null if it isn't legal. */
export function moveFromUci(fen: string, uci: string): Move | null {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}
