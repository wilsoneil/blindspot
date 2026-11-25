"use client";

import { useRef, useState } from "react";
import type { AttemptOutcome } from "@/lib/training/attempts";
import type { ClientPuzzle } from "@/lib/training/client-puzzle";
import { morePuzzles, saveAttempt } from "../actions";
import { AnalysisBoard } from "../analysis-board";
import { PuzzleBoard, type PuzzleResult } from "../puzzle-board";
import type { ReviewChange } from "@/lib/training/review";

/** When a puzzle comes back, in words. */
function reviewNote(r: ReviewChange): string {
  switch (r.kind) {
    case "added":
    case "reset":
      return "It comes back for review tomorrow.";
    case "advanced": {
      const days = Math.round((new Date(r.dueAt).getTime() - Date.now()) / 86_400_000);
      return `Next review in ${days} days.`;
    }
    case "graduated":
      return "Learned: off the review list.";
    default:
      return "";
  }
}

/**
 * Own-pace training with retries, Show solution and analysis. Drill: one weakness.
 * Blindspot mode: all the top weaknesses, unlabelled, plus puzzles due for review.
 */
export function Drill({ mode = "drill", weaknessKeys, profileKey, initial, engineDefault }: {
  mode?: "drill" | "blindspot"; weaknessKeys: string[]; profileKey: string; initial: ClientPuzzle[]; engineDefault: boolean;
}) {
  const [queue, setQueue] = useState(initial);
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0); // bumps to replay the same puzzle
  const [outcome, setOutcome] = useState<AttemptOutcome | null>(null);
  const [result, setResult] = useState<PuzzleResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const sessionId = useRef<number | null>(null);
  const seen = useRef(new Set(initial.map((p) => p.id)));
  const puzzle = queue[index];

  async function onFinish(r: PuzzleResult) {
    setResult(r);
    const saved = await saveAttempt({
      puzzleId: puzzle.id, sessionId: sessionId.current, mode, profileKey,
      weaknessKey: mode === "drill" ? weaknessKeys[0] : null,
      solved: r.solved, solveMs: r.solveMs, wrongMoves: r.wrongMoves, revealed: r.revealed,
    });
    if (saved.ok) {
      sessionId.current = saved.value.sessionId;
      setOutcome(saved.value);
    } else {
      setMessage(saved.message);
    }
    // Keep a few puzzles ahead.
    if (queue.length - index <= 2) {
      const more = await morePuzzles(mode, weaknessKeys, [...seen.current]);
      if (more.ok) {
        const fresh = more.value.filter((p) => !seen.current.has(p.id));
        for (const p of fresh) seen.current.add(p.id);
        setQueue((q) => [...q, ...fresh]);
      }
    }
  }

  function reset() {
    setAnalysing(false);
    setOutcome(null);
    setResult(null);
    setMessage(null);
  }

  function next() {
    reset();
    setLoading(index + 1 >= queue.length);
    setIndex((i) => i + 1);
  }

  if (!puzzle) {
    return <p className="muted">{loading ? "Loading more puzzles…" : "No more unseen puzzles right now."}</p>;
  }

  return (
    <>
      {analysing && (
        <AnalysisBoard
          fen={puzzle.fen}
          line={puzzle.moves}
          // The puzzle's FEN is before the opponent's setup move, so the user plays the other side.
          orientation={puzzle.fen.split(" ")[1] === "w" ? "black" : "white"}
          engineDefault={engineDefault}
        />
      )}
      <div hidden={analysing}>
      <PuzzleBoard
        key={`${puzzle.id}-${round}`}
        fen={puzzle.fen}
        moves={puzzle.moves}
        targetMs={puzzle.targetMs}
        onWrong="retry"
        allowReveal
        onFinish={onFinish}
      />
      </div>
      {result && (
        <div className="save-bar" style={{ marginTop: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" className="button" onClick={next}>Next puzzle</button>
          <button type="button" className="link-button" onClick={() => { reset(); setRound((n) => n + 1); }}>Try again</button>
          <button type="button" className="link-button" onClick={() => setAnalysing((a) => !a)}>
            {analysing ? "Close analysis" : "Analyse"}
          </button>
          <span className="small muted">
            {outcome && !outcome.firstAttempt && !puzzle.review ? "Repeat: trains, but doesn't count. " : ""}
            {outcome ? reviewNote(outcome.review) + " " : ""}
            {outcome ? `Session: ${outcome.session.solved} of ${outcome.session.attempted} solved.` : ""}
          </span>
        </div>
      )}
      {message && <p className="small message-error" style={{ marginTop: "0.5rem" }}>{message}</p>}
      <p className="small muted" style={{ marginTop: "0.75rem" }}>
        {puzzle.review && <span className="pill" style={{ marginRight: "0.4rem" }}>Review</span>}
        Lichess puzzle{" "}
        <a href={`https://lichess.org/training/${puzzle.id}`} target="_blank" rel="noreferrer">{puzzle.id}</a>, rated {puzzle.rating}.
      </p>
    </>
  );
}
