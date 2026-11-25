"use client";

// The analysis board (SPEC.md -> "Puzzle experience"): step back and forward through the
// puzzle's line, move pieces freely to try other moves, and optionally ask Stockfish.
// Only offered once a puzzle is finished, so it never gives an answer away.

import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatScore, pvToSan, whiteShare } from "@/lib/training/engine";
import { useStockfish } from "./use-stockfish";
import "./board.css";

export interface AnalysisBoardProps {
  /** The puzzle's starting position and full line (setup move first). */
  fen: string;
  line: string[];
  /** Which way up: the side the user played. */
  orientation: "white" | "black";
  /** Engine on when the board opens (the "Engine on analysis board" setting). */
  engineDefault: boolean;
}

/** The position after the first `ply` moves of a line, plus the last move played. */
function replay(fen: string, line: string[], ply: number) {
  const chess = new Chess(fen);
  let last: string | undefined;
  for (const uci of line.slice(0, ply)) {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    last = uci;
  }
  return { chess, last };
}

function dests(chess: Chess): Map<Key, Key[]> {
  const out = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) out.set(m.from as Key, [...(out.get(m.from as Key) ?? []), m.to as Key]);
  return out;
}

export function AnalysisBoard({ fen, line: puzzleLine, orientation, engineDefault }: AnalysisBoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const ground = useRef<Api | null>(null);
  const [line, setLine] = useState(puzzleLine);
  const [ply, setPly] = useState(1); // start at the puzzle position, after the setup move
  const [engineOn, setEngineOn] = useState(engineDefault);
  const position = useMemo(() => replay(fen, line, ply), [fen, line, ply]);
  const positionFen = position.chess.fen();
  const engine = useStockfish(positionFen, engineOn);
  const offLine = line.join(" ") !== puzzleLine.join(" ");

  // Moves played on the board: follow the line if it matches, otherwise branch off.
  const lineRef = useRef({ line, ply });
  useEffect(() => {
    lineRef.current = { line, ply };
  }, [line, ply]);

  useEffect(() => {
    if (!el.current) return;
    const g = Chessground(el.current, {
      orientation,
      coordinates: false,
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const { line: l, ply: p } = lineRef.current;
            const { chess } = replay(fen, l, p);
            const piece = chess.get(orig as Square);
            const promo = piece?.type === "p" && (dest[1] === "8" || dest[1] === "1") ? "q" : "";
            const uci = `${orig}${dest}${promo}`;
            if (l[p] === uci) {
              setPly(p + 1);
            } else {
              setLine([...l.slice(0, p), uci]);
              setPly(p + 1);
            }
          },
        },
      },
      premovable: { enabled: false },
      highlight: { lastMove: true, check: true },
    });
    ground.current = g;
    return () => {
      g.destroy();
      ground.current = null;
    };
  }, [fen, orientation]);

  // Show the current position.
  useEffect(() => {
    const { chess, last } = position;
    const turn = chess.turn() === "w" ? "white" : "black";
    ground.current?.set({
      fen: chess.fen(),
      turnColor: turn,
      check: chess.inCheck(),
      lastMove: last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : undefined,
      movable: { color: turn, dests: dests(chess) },
      drawable: {
        autoShapes: engine.lines[0]?.pv[0]
          ? [{ orig: engine.lines[0].pv[0].slice(0, 2) as Key, dest: engine.lines[0].pv[0].slice(2, 4) as Key, brush: "blue" }]
          : [],
      },
    });
  }, [position, engine.lines]);

  // Arrow keys step through the line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      if (e.key === "ArrowRight") setPly((p) => Math.min(lineRef.current.line.length, p + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const best = engine.lines[0];
  return (
    <div>
      {/* Always takes its space, so switching the engine on doesn't move the board (chessground
          measures the board once and would then misplace clicks). */}
      <div className="eval" style={{ visibility: engineOn ? "visible" : "hidden" }}
        aria-hidden={!engineOn} aria-label={best ? `Evaluation ${formatScore(best.score)}` : "Evaluating"}>
        <div className="eval-bar" aria-hidden="true">
          <div className="eval-white" style={{ width: `${best ? whiteShare(best.score) : 50}%` }} />
        </div>
        <span className="eval-score">{best ? formatScore(best.score) : "…"}</span>
      </div>
      <div ref={el} className="board" />
      <div className="analysis-controls">
        <button type="button" onClick={() => setPly(0)} disabled={ply === 0} aria-label="Start">⏮</button>
        <button type="button" onClick={() => setPly((p) => Math.max(0, p - 1))} disabled={ply === 0} aria-label="Back">◀</button>
        <button type="button" onClick={() => setPly((p) => Math.min(line.length, p + 1))} disabled={ply >= line.length} aria-label="Forward">▶</button>
        <button type="button" onClick={() => setPly(line.length)} disabled={ply >= line.length} aria-label="End">⏭</button>
        <label className="toggle small" style={{ marginLeft: "auto" }}>
          <input type="checkbox" checked={engineOn} onChange={(e) => setEngineOn(e.target.checked)} />
          Engine
        </label>
      </div>
      {offLine && (
        <p className="small muted" style={{ margin: "0.5rem 0 0" }}>
          Exploring your own line.{" "}
          <button type="button" className="link-button" onClick={() => { setLine(puzzleLine); setPly(1); }}>Back to the puzzle line</button>
        </p>
      )}
      {engineOn && (
        <div className="engine-lines small">
          {engine.status === "error" && <p className="message-error">The engine couldn&rsquo;t start in this browser.</p>}
          {engine.status === "loading" && <p className="muted">Starting the engine…</p>}
          {position.chess.isGameOver() && <p className="muted">{position.chess.isCheckmate() ? "Checkmate." : "Game over."}</p>}
          {!position.chess.isGameOver() && engine.lines.map((l) => (
            <p key={l.multipv}>
              <strong>{formatScore(l.score)}</strong> <span className="muted">{pvToSan(positionFen, l.pv, 6)}</span>
            </p>
          ))}
          {engine.lines.length > 0 && <p className="muted">Depth {engine.depth}{engine.status === "done" ? "" : "…"}</p>}
        </div>
      )}
    </div>
  );
}
