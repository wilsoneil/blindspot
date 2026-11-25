// Helpers for the in-browser Stockfish on the analysis board (SPEC.md -> "Puzzle experience").
// Pure functions: reading the engine's UCI output and presenting it. The engine itself runs
// in a Web Worker (public/stockfish/), started by the analysis board.

import { Chess } from "chess.js";

export type Score = { cp: number } | { mate: number };

export interface EngineLine {
  depth: number;
  multipv: number;
  /** From White's point of view (UCI scores are from the side to move). */
  score: Score;
  pv: string[]; // UCI moves
}

/** Reads one "info ... pv ..." line. Returns null for anything else (bounds, currmove, strings). */
export function parseInfo(line: string, whiteToMove: boolean): EngineLine | null {
  if (!line.startsWith("info ") || !line.includes(" pv ") || line.includes(" lowerbound") || line.includes(" upperbound")) return null;
  const t = line.split(/\s+/);
  const at = (key: string) => t.indexOf(key);
  const num = (key: string) => (at(key) >= 0 ? Number(t[at(key) + 1]) : NaN);
  const depth = num("depth");
  const multipv = Number.isFinite(num("multipv")) ? num("multipv") : 1;
  const s = at("score");
  if (!Number.isFinite(depth) || s < 0) return null;
  const value = Number(t[s + 2]);
  if (!Number.isFinite(value)) return null;
  const sign = whiteToMove ? 1 : -1;
  const score: Score = t[s + 1] === "mate" ? { mate: sign * value } : { cp: sign * value };
  return { depth, multipv, score, pv: t.slice(at("pv") + 1) };
}

/** Evaluation bar fill for White, 0-100. ±600 centipawns is about as full as it gets; mate is full. */
export function whiteShare(score: Score): number {
  if ("mate" in score) return score.mate > 0 ? 100 : score.mate < 0 ? 0 : 50;
  const winning = 1 / (1 + Math.exp(-0.004 * score.cp)); // the usual logistic curve
  return Math.round(1000 * winning) / 10;
}

/** "+1.3", "−0.4", "M3", "−M2" (from White's point of view). */
export function formatScore(score: Score): string {
  if ("mate" in score) return `${score.mate < 0 ? "−" : ""}M${Math.abs(score.mate)}`;
  const pawns = score.cp / 100;
  return `${pawns > 0 ? "+" : pawns < 0 ? "−" : ""}${Math.abs(pawns).toFixed(1)}`;
}

/** The first moves of a line in normal notation, numbered: "12. Nf3 Nc6 13. d4". */
export function pvToSan(fen: string, pv: string[], max = 5): string {
  const chess = new Chess(fen);
  const parts: string[] = [];
  for (const uci of pv.slice(0, max)) {
    const white = chess.turn() === "w";
    const n = chess.moveNumber();
    let san: string;
    try {
      san = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
    } catch {
      break;
    }
    if (white) parts.push(`${n}. ${san}`);
    else parts.push(parts.length === 0 ? `${n}… ${san}` : san);
  }
  return parts.join(" ");
}
