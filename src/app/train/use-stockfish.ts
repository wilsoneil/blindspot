"use client";

// Runs Stockfish in a Web Worker and analyses one position at a time, showing the top
// two lines. The worker only starts when the engine is switched on, so the 7 MB download
// happens only for people who use it.

import { useEffect, useRef, useState } from "react";
import { parseInfo, type EngineLine } from "@/lib/training/engine";

export const ENGINE_URL = "/stockfish/stockfish-18-lite-single.js";
const LINES = 2;
const DEPTH = 18;

export interface EngineState {
  status: "off" | "loading" | "thinking" | "done" | "error";
  lines: EngineLine[]; // best first
  depth: number;
}

export function useStockfish(fen: string, enabled: boolean): EngineState {
  const worker = useRef<Worker | null>(null);
  const searching = useRef(false);
  const pending = useRef<string | null>(null); // next position, sent once the old search has stopped
  const current = useRef<string | null>(null);
  const [state, setState] = useState<EngineState>({ status: "off", lines: [], depth: 0 });

  // Start or stop the worker.
  useEffect(() => {
    if (!enabled) return;
    let w: Worker;
    try {
      w = new Worker(ENGINE_URL);
    } catch {
      queueMicrotask(() => setState({ status: "error", lines: [], depth: 0 }));
      return;
    }
    worker.current = w;
    queueMicrotask(() => setState({ status: "loading", lines: [], depth: 0 }));

    const start = (position: string) => {
      current.current = position;
      searching.current = true;
      setState({ status: "thinking", lines: [], depth: 0 });
      w.postMessage(`position fen ${position}`);
      w.postMessage(`go depth ${DEPTH}`);
    };

    w.onmessage = (e: MessageEvent<string>) => {
      const line = String(e.data);
      if (line === "readyok") {
        const next = pending.current;
        pending.current = null;
        if (next) start(next);
        return;
      }
      if (line.startsWith("bestmove")) {
        searching.current = false;
        const next = pending.current;
        if (next) {
          pending.current = null;
          start(next);
        } else {
          setState((s) => ({ ...s, status: "done" }));
        }
        return;
      }
      if (pending.current || !current.current) return; // output from a search we've moved on from
      const info = parseInfo(line, current.current.split(" ")[1] === "w");
      if (!info || info.multipv > LINES) return;
      setState((s) => {
        const lines = [...s.lines];
        lines[info.multipv - 1] = info;
        return { status: "thinking", lines: lines.filter(Boolean), depth: Math.max(s.depth, info.depth) };
      });
    };
    w.onerror = () => setState({ status: "error", lines: [], depth: 0 });
    w.postMessage("uci");
    w.postMessage(`setoption name MultiPV value ${LINES}`);
    w.postMessage("isready");

    return () => {
      w.terminate();
      worker.current = null;
      searching.current = false;
      current.current = null;
      setState({ status: "off", lines: [], depth: 0 });
    };
  }, [enabled]);

  // A new position: stop the old search and start the new one once it has stopped.
  useEffect(() => {
    const w = worker.current;
    if (!enabled) return;
    pending.current = fen;
    if (w && searching.current) w.postMessage("stop");
    else if (w && current.current !== null) {
      pending.current = null;
      w.postMessage(`position fen ${fen}`);
      current.current = fen;
      searching.current = true;
      queueMicrotask(() => setState({ status: "thinking", lines: [], depth: 0 }));
      w.postMessage(`go depth ${DEPTH}`);
    }
    // Otherwise the worker is still starting: "readyok" picks up the pending position.
  }, [fen, enabled]);

  return enabled ? state : { status: "off", lines: [], depth: 0 };
}
