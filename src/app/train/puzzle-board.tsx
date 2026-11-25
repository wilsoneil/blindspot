"use client";

// The puzzle board (SPEC.md -> "Puzzle experience"): chessground for the board,
// PuzzleRun (src/lib/training/play.ts) for the chess. Plays the opponent's setup move,
// checks each move, plays the replies and times the solve.

import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Square } from "chess.js";
import { PuzzleRun, type Uci } from "@/lib/training/play";
import "./board.css";

export interface PuzzleResult {
  /** The user played through to the end of the solution. */
  solved: boolean;
  /** The user asked to see the solution. */
  revealed: boolean;
  /** Solved with no wrong moves and without revealing the solution. */
  correct: boolean;
  /** From the user's first chance to move until the last move, retries included. */
  solveMs: number;
  wrongMoves: number;
}

export interface PuzzleBoardProps {
  fen: string;
  moves: Uci[];
  targetMs: number;
  /** "retry": a wrong move is taken back and the user tries again (Drill, Blindspot). "end": it ends the puzzle (Rush, Survival). */
  onWrong?: "retry" | "end";
  onFinish?: (result: PuzzleResult) => void;
  /** Show a "Show solution" button (Drill, Blindspot). */
  allowReveal?: boolean;
}

type Status =
  | { kind: "loading" }
  | { kind: "playing"; note?: "correct" | "wrong" }
  | { kind: "solved"; result: PuzzleResult }
  | { kind: "failed"; result: PuzzleResult }
  | { kind: "revealing" };

const SETUP_DELAY_MS = 600; // show the starting position briefly before the opponent's move
const REPLY_DELAY_MS = 350;
const PROMOTION_PIECES = [
  { piece: "q", symbol: "♛", name: "Queen" },
  { piece: "r", symbol: "♜", name: "Rook" },
  { piece: "b", symbol: "♝", name: "Bishop" },
  { piece: "n", symbol: "♞", name: "Knight" },
] as const;

const squares = (uci: Uci): Key[] => [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key];

export function PuzzleBoard({ fen, moves, targetMs, onWrong = "retry", onFinish, allowReveal = false }: PuzzleBoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const ground = useRef<Api | null>(null);
  const run = useRef<PuzzleRun | null>(null);
  const startedAt = useRef(0);
  const wrongMoves = useRef(0);
  const finished = useRef(false);
  const revealing = useRef(false); // the board plays the solution itself; no user moves
  const onFinishRef = useRef(onFinish);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const movesKey = moves.join(" "); // a new array with the same moves mustn't restart the puzzle

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  /** Puts the board in step with the puzzle: position, whose move, legal moves. */
  const sync = useCallback((lastMove?: Uci) => {
    const r = run.current;
    const g = ground.current;
    if (!r || !g) return;
    const color = r.chess.turn() === "w" ? "white" : "black";
    g.set({
      fen: r.fen,
      turnColor: color,
      check: r.chess.inCheck(),
      ...(lastMove ? { lastMove: squares(lastMove) } : {}),
      movable: { color: r.solved || finished.current || revealing.current ? undefined : r.userColor, dests: r.dests() as Map<Key, Key[]> },
    });
  }, []);

  const finish = useCallback((solved: boolean, revealed = false) => {
    if (finished.current) return;
    finished.current = true;
    const result: PuzzleResult = {
      solved,
      revealed,
      correct: solved && !revealed && wrongMoves.current === 0,
      solveMs: Math.round(performance.now() - startedAt.current),
      wrongMoves: wrongMoves.current,
    };
    setStatus(solved ? { kind: "solved", result } : { kind: "failed", result });
    ground.current?.set({ movable: { color: undefined, dests: new Map() } });
    onFinishRef.current?.(result);
  }, []);

  const submit = useCallback((uci: Uci) => {
    const r = run.current;
    if (!r || finished.current || revealing.current) return;
    const outcome = r.play(uci);
    switch (outcome.result) {
      case "solved":
        sync(uci);
        finish(true);
        return;
      case "correct":
        setStatus({ kind: "playing", note: "correct" });
        // Show the user's move first, then the opponent's reply.
        ground.current?.set({ movable: { dests: new Map() } });
        setTimeout(() => sync(outcome.reply), REPLY_DELAY_MS);
        return;
      case "wrong":
        wrongMoves.current++;
        if (onWrong === "end") {
          finish(false);
          return;
        }
        setStatus({ kind: "playing", note: "wrong" });
        setTimeout(() => sync(), REPLY_DELAY_MS); // take the move back
        return;
      case "illegal":
        sync();
    }
  }, [finish, onWrong, sync]);

  // Create the board once per puzzle.
  useEffect(() => {
    if (!el.current) return;
    let r: PuzzleRun;
    try {
      r = new PuzzleRun(fen, movesKey.split(" "));
    } catch (e) {
      // Shown below the board; the board itself stays empty.
      queueMicrotask(() => setError(e instanceof Error ? e.message : "This puzzle can't be played."));
      return;
    }
    run.current = r;
    finished.current = false;
    revealing.current = false;
    wrongMoves.current = 0;
    const g = Chessground(el.current, {
      fen,
      orientation: r.userColor,
      coordinates: false,
      movable: { free: false, showDests: true, events: { after: (orig, dest) => onMove(orig, dest) } },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      highlight: { lastMove: true, check: true },
    });
    ground.current = g;

    function onMove(orig: Key, dest: Key) {
      const rr = run.current;
      if (!rr) return;
      if (rr.isPromotion(orig as Square, dest as Square)) setPromotion({ from: orig as Square, to: dest as Square });
      else submit(`${orig}${dest}`);
    }

    const timer = setTimeout(() => {
      sync(r.setupMove);
      startedAt.current = performance.now();
      setStatus({ kind: "playing" });
    }, SETUP_DELAY_MS);

    return () => {
      clearTimeout(timer);
      g.destroy();
      ground.current = null;
      run.current = null;
    };
  }, [fen, movesKey, submit, sync]);

  // The clock, while the puzzle is being played.
  useEffect(() => {
    if (status.kind !== "playing") return;
    const id = setInterval(() => setElapsed(performance.now() - startedAt.current), 200);
    return () => clearInterval(id);
  }, [status.kind]);

  /** Plays the rest of the solution on the board, one move at a time. */
  const reveal = () => {
    const r = run.current;
    if (!r || finished.current) return;
    const solveMs = performance.now() - startedAt.current;
    setPromotion(null);
    revealing.current = true;
    setStatus({ kind: "revealing" });
    ground.current?.set({ movable: { color: undefined, dests: new Map() } });
    const step = () => {
      const move = r.expectedMove();
      if (!move) {
        startedAt.current = performance.now() - solveMs; // the time stops at the reveal
        finish(false, true);
        return;
      }
      const outcome = r.play(move);
      sync(outcome.result === "correct" ? outcome.reply : move);
      setTimeout(step, REPLY_DELAY_MS * 2);
    };
    step();
  };

  const choosePromotion = (piece: string) => {
    if (!promotion) return;
    setPromotion(null);
    submit(`${promotion.from}${promotion.to}${piece}`);
  };

  const shownMs = status.kind === "solved" || status.kind === "failed" ? status.result.solveMs : elapsed;
  const colour = run.current?.userColor;
  const message = error
    ? error
    : status.kind === "loading"
      ? "Get ready…"
      : status.kind === "solved"
        ? status.result.correct
          ? status.result.solveMs <= targetMs ? "Solved!" : "Solved, but slower than the target time."
          : `Solved, after ${status.result.wrongMoves} wrong move${status.result.wrongMoves === 1 ? "" : "s"}.`
        : status.kind === "failed"
          ? status.result.revealed ? "Solution shown." : "Not this time."
          : status.kind === "revealing"
            ? "Showing the solution…"
          : status.note === "wrong"
            ? "Not that one. Try again."
            : status.note === "correct"
              ? "Good. Keep going."
              : `Your move (${colour === "white" ? "White" : "Black"}). Find the best move.`;

  return (
    <div>
      <div ref={el} className="board" />
      {promotion && (
        <div className="promotion" role="group" aria-label="Promote to">
          <span className="small muted">Promote to</span>
          {PROMOTION_PIECES.map((p) => (
            <button key={p.piece} type="button" onClick={() => choosePromotion(p.piece)} aria-label={p.name} title={p.name}>
              {p.symbol}
            </button>
          ))}
          <button type="button" onClick={() => { setPromotion(null); sync(); }} aria-label="Cancel" title="Cancel">×</button>
        </div>
      )}
      {allowReveal && status.kind === "playing" && (
        <button type="button" className="link-button" style={{ marginTop: "0.5rem" }} onClick={reveal}>Show solution</button>
      )}
      <p className="puzzle-status" aria-live="polite">
        <span className={error || status.kind === "failed" || (status.kind === "playing" && status.note === "wrong") ? "message-error" : status.kind === "solved" ? "message-ok" : undefined}>
          {message}
        </span>
        <span className={`timer${shownMs > targetMs ? " over" : ""}`}>
          {(shownMs / 1000).toFixed(1)} s <span className="muted">/ {Math.round(targetMs / 1000)} s</span>
        </span>
      </p>
    </div>
  );
}
