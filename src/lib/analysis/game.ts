// Analyses one game: evaluates every position, finds the user's mistakes and tags them.
// (SPEC.md -> "Game analysis pipeline", steps 2 and 3.)
//
// The engine and tagger are passed in, so tests can use made-up ones. The real ones
// (Stockfish and the Lichess tagger) are in scripts/lib/.

import { Chess } from "chess.js";
import { tacticLabels } from "../labels";
import {
  developmentDone, endgameTypeOf, moveTypeSituations, moveTypesOf, phaseOf, positionStateOf, type Phase,
} from "./classify";
import { centipawns, flip, MISTAKE_THRESHOLD, winProbability, type Score } from "./eval";
import { gameOpening, type GameOpening } from "./openings";
import { readGame, uciToSan, type Colour } from "./positions";

export interface Evaluation {
  score: Score; // from the side to move
  pv: string[]; // best line, UCI
}

export interface Evaluator {
  /** Clears the engine's memory, so each game is analysed the same way whatever came before. */
  newGame(): Promise<void>;
  evaluate(fen: string): Promise<Evaluation>;
}

/** A line in the Lichess puzzle format: the first move sets the puzzle, the solver plays the rest. */
export interface TaggerInput {
  fen: string;
  moves: string[];
  /** The solver's evaluation, in centipawns (forced mates as ±10000). */
  cp: number;
}

export interface Tagger {
  /** Lichess theme names, e.g. ["fork", "middlegame"]. */
  tag(input: TaggerInput): Promise<string[]>;
}

export interface GameToAnalyse {
  pgn: string;
  colour: Colour;
  openingName: string | null;
}

export interface FoundMistake {
  ply: number;
  moveNumber: number;
  fen: string; // before the user's move
  playedUci: string;
  playedSan: string;
  bestUci: string;
  bestSan: string;
  /** Evaluations from the user's side, before and after the move. */
  before: Score;
  after: Score;
  /** Winning chance lost, from 0 to 1 (0.25 = 25 percentage points). */
  drop: number;
  phase: Phase;
  labels: string[];
  bestLine: string[];
  refutation: string[];
}

export interface GameAnalysis {
  mistakes: FoundMistake[];
  /** Labels whose situation arose at one of the user's moves (tactics and mates are assumed to arise in every game). */
  situations: string[];
  opening: GameOpening;
  positions: number;
}

function terminal(fen: string): Evaluation | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { score: { mate: 0 }, pv: [] };
  if (chess.isStalemate() || chess.isInsufficientMaterial()) return { score: { cp: 0 }, pv: [] };
  return null;
}

export async function analyseGame(game: GameToAnalyse, engine: Evaluator, tagger: Tagger): Promise<GameAnalysis> {
  const { plies, finalFen } = readGame(game.pgn);
  const opening = gameOpening(game.colour, game.openingName, plies.slice(0, 2).map((p) => p.san));

  // 1. Evaluate every position, including the final one.
  await engine.newGame();
  const fens = [...plies.map((p) => p.fenBefore), finalFen];
  const evals: Evaluation[] = [];
  for (const fen of fens) evals.push(terminal(fen) ?? (await engine.evaluate(fen)));

  // Position i has White to move when i is even.
  const userToMove = (i: number) => (i % 2 === 0) === (game.colour === "white");
  const forUser = (i: number): Score => (userToMove(i) ? evals[i].score : flip(evals[i].score));

  // 2. Go through the user's moves.
  const situations = new Set<string>();
  const mistakes: FoundMistake[] = [];
  let developed = false;

  for (const ply of plies) {
    if (ply.colour !== game.colour) continue;
    const i = ply.index;
    const chess = new Chess(ply.fenBefore);
    const board = chess.board();
    developed ||= developmentDone(board, game.colour);

    const phase = phaseOf(board, ply.moveNumber, developed);
    const endgame = endgameTypeOf(board);
    const before = forUser(i);
    const after = forUser(i + 1);
    const state = positionStateOf(before);
    const legal = chess.moves({ verbose: true });
    const prev = i > 0 ? plies[i - 1] : null;
    const previous = prev ? { to: prev.to, captured: prev.captured } : null;

    situations.add(phase);
    if (endgame) situations.add(endgame);
    situations.add(state);
    for (const s of moveTypeSituations({ legal, previous })) situations.add(s);

    const bestUci = evals[i].pv[0];
    if (!bestUci || bestUci === ply.uci) continue;
    const drop = winProbability(before) - winProbability(after);
    if (drop < MISTAKE_THRESHOLD) continue;

    const played = legal.find((m) => m.lan === ply.uci)!;
    const best = legal.find((m) => m.lan === bestUci) ?? null;
    const labels = new Set<string>([phase, state, ...moveTypesOf({ legal, played, best, previous })]);
    if (endgame) labels.add(endgame);

    // Allowed: the user's move let the opponent play a tactic. The puzzle starts with the
    // user's move, and the opponent "solves" it with the engine's best reply line.
    const reply = evals[i + 1].pv;
    if (reply.length) {
      const themes = await tagger.tag({ fen: ply.fenBefore, moves: [ply.uci, ...reply], cp: centipawns(flip(after)) });
      for (const l of tacticLabels(themes, "allowed")) labels.add(l);
    }

    // Missed: the user had a tactic and didn't play it. Only when there was a real chance:
    // the opponent's last move handed over at least a mistake's worth of winning chance,
    // or there was a forced mate. The puzzle starts with the opponent's move.
    if (prev) {
      const gift = winProbability(before) - winProbability(forUser(i - 1));
      const mateOn = "mate" in before && before.mate > 0;
      if (gift >= MISTAKE_THRESHOLD || mateOn) {
        const themes = await tagger.tag({ fen: prev.fenBefore, moves: [prev.uci, ...evals[i].pv], cp: centipawns(before) });
        for (const l of tacticLabels(themes, "missed")) labels.add(l);
      }
    }

    mistakes.push({
      ply: i,
      moveNumber: ply.moveNumber,
      fen: ply.fenBefore,
      playedUci: ply.uci,
      playedSan: ply.san,
      bestUci,
      bestSan: best?.san ?? uciToSan(ply.fenBefore, bestUci) ?? bestUci,
      before,
      after,
      drop: Math.round(drop * 1000) / 1000,
      phase,
      labels: [...labels],
      bestLine: evals[i].pv,
      refutation: reply,
    });
  }

  return { mistakes, situations: [...situations], opening, positions: fens.length };
}
