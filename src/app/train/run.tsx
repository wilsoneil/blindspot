"use client";

// A Rush or Survival run (SPEC.md -> "Training modes"). Puzzles come one after another;
// a wrong move ends the puzzle and costs a life. Both end when the lives are used up, and
// Rush also when the clock runs out. Every finished puzzle is saved as an attempt.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { attemptRef, type ClientPuzzle } from "@/lib/training/client-puzzle";
import { CHUNK } from "@/lib/training/run";
import { moreRunPuzzles, saveAttempt } from "./actions";
import { PuzzleBoard, type PuzzleResult } from "./puzzle-board";

interface Props {
  mode: "rush" | "survival";
  profileKey: string;
  weaknessKeys: string[];
  initial: ClientPuzzle[];
  rushMs: number;
  lives: number;
  /** What the mode is, shown only before the run starts. */
  intro: string;
}

type Done = { puzzle: ClientPuzzle; correct: boolean };
const NEXT_DELAY_MS = 600;

export function Run({ mode, profileKey, weaknessKeys, initial, rushMs, lives, intro }: Props) {
  const [phase, setPhase] = useState<"ready" | "playing" | "over">("ready");
  const [queue, setQueue] = useState(initial);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Done[]>([]);
  const [livesLeft, setLivesLeft] = useState(lives);
  const [now, setNow] = useState(0);
  const [endReason, setEndReason] = useState("");
  const [exhausted, setExhausted] = useState(false); // the last fetch found nothing new
  const [deadline, setDeadline] = useState(0);
  const sessionId = useRef<number | null>(null);
  const saving = useRef<Promise<unknown>>(Promise.resolve()); // saves run one after another
  const nextChunk = useRef(Math.ceil(initial.length / CHUNK));
  const fetching = useRef(false);
  const puzzle = queue[index];
  const score = done.filter((d) => d.correct).length;

  const end = useCallback((reason: string) => {
    setPhase("over");
    setEndReason(reason);
  }, []);

  // The Rush clock.
  useEffect(() => {
    if (phase !== "playing" || mode !== "rush") return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) end("Time's up.");
    }, 200);
    return () => clearInterval(id);
  }, [phase, mode, end, deadline]);

  function start() {
    setDeadline(Date.now() + rushMs);
    setNow(Date.now());
    setPhase("playing");
  }

  async function topUp(currentIndex: number, current: ClientPuzzle[]) {
    if (fetching.current || current.length - currentIndex > 3) return;
    fetching.current = true;
    const more = await moreRunPuzzles(weaknessKeys, nextChunk.current, current.map((p) => p.id));
    fetching.current = false;
    const fresh = more.ok ? more.value.filter((p) => !current.some((x) => x.id === p.id)) : [];
    nextChunk.current += 2;
    if (fresh.length === 0) setExhausted(true);
    else setQueue((q) => [...q, ...fresh.filter((p) => !q.some((x) => x.id === p.id))]);
  }

  // Ran past the end of the queue and nothing more is coming.
  useEffect(() => {
    if (phase === "playing" && !puzzle && exhausted) queueMicrotask(() => end("You've run out of puzzles for now."));
  }, [phase, puzzle, exhausted, end]);

  function onFinish(r: PuzzleResult) {
    if (phase !== "playing") return;
    const p = puzzle;
    saving.current = saving.current.then(async () => {
      const saved = await saveAttempt({
        ...attemptRef(p), sessionId: sessionId.current, mode, profileKey,
        solved: r.solved, solveMs: r.solveMs, wrongMoves: r.wrongMoves, revealed: false,
      });
      if (saved.ok) sessionId.current = saved.value.sessionId;
    });
    setDone((d) => [...d, { puzzle: p, correct: r.correct }]);
    let over = false;
    if (!r.correct) {
      const left = livesLeft - 1;
      setLivesLeft(left);
      if (left <= 0) {
        over = true;
        end("Out of lives.");
      }
    }
    if (!over) {
      setTimeout(() => setIndex((i) => i + 1), NEXT_DELAY_MS);
      void topUp(index + 1, queue);
    }
  }

  if (phase === "ready") {
    return (
      <>
        <p className="small muted">{intro}</p>
        <div className="save-bar" style={{ margin: "0.5rem 0 1rem" }}>
          <button type="button" className="button" onClick={start} disabled={!puzzle}>
            {mode === "rush" ? `Start the ${Math.round(rushMs / 60_000)}-minute rush` : "Start"}
          </button>
          {!puzzle && <span className="small muted">No unseen puzzles for your weaknesses right now.</span>}
        </div>
      </>
    );
  }

  if (phase === "over") {
    return (
      <div style={{ margin: "0.5rem 0 1rem" }}>
        <p className="muted" style={{ marginBottom: "0.25rem" }}>{endReason}</p>
        <div className="stats">
          <div className="stat"><div className="stat-value">{score}</div><div className="stat-label">solved</div></div>
          <div className="stat"><div className="stat-value">{done.length}</div><div className="stat-label">attempted</div></div>
        </div>
        {done.length > 0 && (
          <ol className="run-results small">
            {done.map((d) => (
              <li key={d.puzzle.id}>
                <span className={d.correct ? "check" : "cross"}>{d.correct ? "✓" : "✗"}</span>{" "}
                {d.puzzle.position ? (
                  <span>Your game: {d.puzzle.position.bestSan}</span>
                ) : (
                  <>
                    <a href={`https://lichess.org/training/${d.puzzle.id}`} target="_blank" rel="noreferrer">{d.puzzle.id}</a>{" "}
                    <span className="muted">{d.puzzle.rating}</span>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
        <div className="save-bar" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="button" onClick={() => window.location.reload()}>Play again</button>
          <Link href="/" className="small">Home</Link>
        </div>
      </div>
    );
  }

  const left = Math.max(0, deadline - now);
  return (
    <>
      <div className="run-head">
        <span><strong>{score}</strong> <span className="muted">solved</span></span>
        {puzzle?.review && <span className="pill" title="A puzzle you missed before, back for review">Review</span>}
        <span aria-label={`${livesLeft} ${livesLeft === 1 ? "life" : "lives"} left`} className="run-lives">
          {"♥".repeat(livesLeft)}<span className="muted">{"♡".repeat(Math.max(0, lives - livesLeft))}</span>
        </span>
        {mode === "rush" && (
          <span className={`run-clock${left < 30_000 ? " over" : ""}`}>
            {Math.floor(left / 60_000)}:{String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}
          </span>
        )}
      </div>
      {puzzle ? (
        <PuzzleBoard key={puzzle.id} fen={puzzle.fen} moves={puzzle.moves} accepted={puzzle.position?.accepted}
          targetMs={puzzle.targetMs} onWrong="end" onFinish={onFinish} />
      ) : (
        <p className="muted">Loading more puzzles…</p>
      )}
    </>
  );
}
