// What the browser gets for each puzzle or position: what to show, and the target time.

import type { Settings } from "../settings";
import { targetTimeMs } from "./play";
import type { PositionDetails, TrainingPuzzle } from "./select";

export interface ClientPuzzle {
  id: string; // Lichess puzzle id, or "m<mistake id>" for the user's own position
  fen: string;
  moves: string[];
  rating: number; // for own positions, a stand-in from how subtle the move is
  targetMs: number;
  /** Rush / Survival: a past failure or slow solve, back for review. */
  review?: boolean;
  /** A "find the move" position from the user's own game. */
  position?: PositionDetails;
}

/** Which record an attempt is saved against. */
export function attemptRef(p: ClientPuzzle): { puzzleId: string } | { mistakeId: number } {
  return p.position ? { mistakeId: p.position.mistakeId } : { puzzleId: p.id };
}

export function clientPuzzle(p: TrainingPuzzle & { review?: boolean }, settings: Settings, level: number): ClientPuzzle {
  // Own positions: one move, and no "well above your level" extra time (as the server decides).
  const targetMs = p.position
    ? targetTimeMs({ userMoves: 1, puzzleRating: level, level, setting: settings.targetTime })
    : targetTimeMs({ userMoves: p.moves.length / 2, puzzleRating: p.rating, level, setting: settings.targetTime });
  return {
    ...(p.review ? { review: true } : {}),
    ...(p.position ? { position: p.position } : {}),
    id: p.id,
    fen: p.fen,
    moves: p.moves,
    rating: p.rating,
    targetMs,
  };
}
