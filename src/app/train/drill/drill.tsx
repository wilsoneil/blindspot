"use client";

import { useRef, useState } from "react";
import type { AttemptOutcome } from "@/lib/training/attempts";
import type { ClientPuzzle } from "@/lib/training/client-puzzle";
import { morePuzzles, saveAttempt } from "../actions";
import { PuzzleBoard, type PuzzleResult } from "../puzzle-board";

export function Drill({ weaknessKey, profileKey, initial }: { weaknessKey: string; profileKey: string; initial: ClientPuzzle[] }) {
  const [queue, setQueue] = useState(initial);
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0); // bumps to replay the same puzzle
  const [outcome, setOutcome] = useState<AttemptOutcome | null>(null);
  const [result, setResult] = useState<PuzzleResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sessionId = useRef<number | null>(null);
  const seen = useRef(new Set(initial.map((p) => p.id)));
  const puzzle = queue[index];

  async function onFinish(r: PuzzleResult) {
    setResult(r);
    const saved = await saveAttempt({
      puzzleId: puzzle.id, sessionId: sessionId.current, mode: "drill", profileKey, weaknessKey,
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
      const more = await morePuzzles(weaknessKey, [...seen.current]);
      if (more.ok) {
        const fresh = more.value.filter((p) => !seen.current.has(p.id));
        for (const p of fresh) seen.current.add(p.id);
        setQueue((q) => [...q, ...fresh]);
      }
    }
  }

  function reset() {
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
    return <p className="muted">{loading ? "Loading more puzzles…" : "No more unseen puzzles for this weakness right now."}</p>;
  }

  return (
    <>
      <PuzzleBoard
        key={`${puzzle.id}-${round}`}
        fen={puzzle.fen}
        moves={puzzle.moves}
        targetMs={puzzle.targetMs}
        onWrong="retry"
        allowReveal
        onFinish={onFinish}
      />
      {result && (
        <div className="save-bar" style={{ marginTop: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" className="button" onClick={next}>Next puzzle</button>
          <button type="button" className="link-button" onClick={() => { reset(); setRound((n) => n + 1); }}>Try again</button>
          <span className="small muted">
            {outcome && !outcome.firstAttempt ? "Repeat: trains, but doesn't count. " : ""}
            {outcome ? `Session: ${outcome.session.solved} of ${outcome.session.attempted} solved.` : ""}
          </span>
        </div>
      )}
      {message && <p className="small message-error" style={{ marginTop: "0.5rem" }}>{message}</p>}
      <p className="small muted" style={{ marginTop: "0.75rem" }}>
        Lichess puzzle{" "}
        <a href={`https://lichess.org/training/${puzzle.id}`} target="_blank" rel="noreferrer">{puzzle.id}</a>, rated {puzzle.rating}.
      </p>
    </>
  );
}
