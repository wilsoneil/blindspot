// What the browser gets for each puzzle or position: what to show, and the target time.

import type { Settings } from "../settings";
import { itemTargetMs } from "./play";
import type { ReviewItem } from "./review";
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
export function attemptRef(p: ClientPuzzle): ReviewItem {
  return p.position ? { mistakeId: p.position.mistakeId } : { puzzleId: p.id };
}

export function clientPuzzle(p: TrainingPuzzle & { review?: boolean }, settings: Settings, level: number): ClientPuzzle {
  // Own positions: one move, and no rating of their own (as the server decides).
  const targetMs = itemTargetMs(
    p.position ? { userMoves: 1, rating: null } : { userMoves: p.moves.length / 2, rating: p.rating }, level, settings.targetTime);
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
