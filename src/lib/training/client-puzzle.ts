// What the browser gets for each puzzle: the position, the moves and the target time.

import type { Settings } from "../settings";
import { targetTimeMs } from "./play";
import type { TrainingPuzzle } from "./select";

export interface ClientPuzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  targetMs: number;
}

export function clientPuzzle(p: TrainingPuzzle, settings: Settings, level: number): ClientPuzzle {
  return {
    id: p.id,
    fen: p.fen,
    moves: p.moves,
    rating: p.rating,
    targetMs: targetTimeMs({ userMoves: p.moves.length / 2, puzzleRating: p.rating, level, setting: settings.targetTime }),
  };
}
