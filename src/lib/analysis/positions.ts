// Turns a game's PGN into the list of moves with the position before each one.

import { Chess, type PieceSymbol, type Square } from "chess.js";

export type Colour = "white" | "black";

export interface Ply {
  /** 0-based half-move index: 0 = White's first move. */
  index: number;
  moveNumber: number;
  colour: Colour;
  /** Position before this move. */
  fenBefore: string;
  uci: string;
  san: string;
  piece: PieceSymbol;
  from: Square;
  to: Square;
  /** The piece taken, if the move is a capture. */
  captured?: PieceSymbol;
}

export interface GameMoves {
  plies: Ply[];
  /** Position after the last move. */
  finalFen: string;
}

/** Reads a PGN (with or without clock comments). Throws if the moves are illegal. */
export function readGame(pgn: string): GameMoves {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  const plies = history.map((m, index) => ({
    index,
    moveNumber: Math.floor(index / 2) + 1,
    colour: m.color === "w" ? "white" as const : "black" as const,
    fenBefore: m.before,
    uci: m.lan,
    san: m.san,
    piece: m.piece,
    from: m.from,
    to: m.to,
    captured: m.captured,
  }));
  return { plies, finalFen: chess.fen() };
}

/** Converts a line of UCI moves to SAN from a position; stops at the first illegal move. */
export function uciToSan(fen: string, uci: string): string | null {
  const chess = new Chess(fen);
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}
