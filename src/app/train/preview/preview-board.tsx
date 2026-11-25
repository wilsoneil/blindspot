"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PuzzleBoard, type PuzzleResult } from "../puzzle-board";

export function PreviewBoard({ puzzle, targetMs }: {
  puzzle: { id: string; fen: string; moves: string[]; rating: number };
  targetMs: number;
}) {
  const router = useRouter();
  const [result, setResult] = useState<PuzzleResult | null>(null);
  return (
    <>
      <PuzzleBoard key={puzzle.id} fen={puzzle.fen} moves={puzzle.moves} targetMs={targetMs} onFinish={setResult} />
      <div className="save-bar" style={{ marginTop: "0.75rem" }}>
        <button type="button" className="button" onClick={() => { setResult(null); router.refresh(); }}>
          {result ? "Next puzzle" : "Skip"}
        </button>
        <span className="small muted">
          Lichess puzzle{" "}
          <a href={`https://lichess.org/training/${puzzle.id}`} target="_blank" rel="noreferrer">{puzzle.id}</a>
          , rated {puzzle.rating}
        </span>
      </div>
    </>
  );
}
