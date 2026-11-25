// Talks to a Stockfish program over UCI, the standard chess-engine protocol.
// Used by the analysis job only (never by the website).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Evaluation, Evaluator } from "../../src/lib/analysis/game";
import type { Score } from "../../src/lib/analysis/eval";

export interface EngineOptions {
  path: string;
  threads: number;
  hashMb: number;
  nodes: number;
}

/** Reads the score and best line from a UCI "info" line, or null if it has none (or is only a bound). */
export function parseInfo(line: string): Evaluation | null {
  const t = line.split(" ");
  if (t[0] !== "info") return null;
  const multipv = t.indexOf("multipv");
  if (multipv !== -1 && t[multipv + 1] !== "1") return null;
  const s = t.indexOf("score");
  const pv = t.indexOf("pv");
  if (s === -1 || pv === -1) return null;
  if (t[s + 3] === "lowerbound" || t[s + 3] === "upperbound") return null;
  const value = Number(t[s + 2]);
  if (!Number.isFinite(value)) return null;
  const score: Score = t[s + 1] === "mate" ? { mate: value } : { cp: value };
  return { score, pv: t.slice(pv + 1).filter(Boolean) };
}

export class Stockfish implements Evaluator {
  private onLine: ((line: string) => void) | null = null;
  private failed: Error | null = null;

  private constructor(private proc: ChildProcessWithoutNullStreams, private nodes: number) {
    createInterface({ input: proc.stdout }).on("line", (line) => this.onLine?.(line));
    const fail = (e: Error) => {
      this.failed = e;
      this.onLine?.("");
    };
    proc.on("error", fail);
    proc.on("exit", (code) => fail(new Error(`Stockfish stopped (exit code ${code})`)));
  }

  static async start(o: EngineOptions): Promise<Stockfish> {
    const engine = new Stockfish(spawn(o.path, [], { stdio: "pipe" }), o.nodes);
    await engine.until("uci", (l) => l === "uciok");
    engine.send(`setoption name Threads value ${o.threads}`);
    engine.send(`setoption name Hash value ${o.hashMb}`);
    await engine.until("isready", (l) => l === "readyok");
    return engine;
  }

  /** Reports the engine's name, to check the pinned version is the one running. */
  static async identify(path: string): Promise<string> {
    const proc = spawn(path, [], { stdio: "pipe" });
    const engine = new Stockfish(proc, 0);
    let name = "";
    await engine.until("uci", (l) => {
      if (l.startsWith("id name ")) name = l.slice(8);
      return l === "uciok";
    });
    engine.quit();
    return name;
  }

  private send(cmd: string) {
    this.proc.stdin.write(cmd + "\n");
  }

  /** Sends a command and waits for the line that ends its answer. */
  private until(cmd: string, done: (line: string) => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.onLine = (line) => {
        if (this.failed) return reject(this.failed);
        if (done(line)) {
          this.onLine = null;
          resolve();
        }
      };
      if (this.failed) return reject(this.failed);
      this.send(cmd);
    });
  }

  async newGame() {
    this.send("ucinewgame");
    await this.until("isready", (l) => l === "readyok");
  }

  async evaluate(fen: string): Promise<Evaluation> {
    this.send(`position fen ${fen}`);
    let last: Evaluation | null = null;
    let bestmove = "";
    await this.until(`go nodes ${this.nodes}`, (line) => {
      const info = parseInfo(line);
      if (info) last = info;
      if (line.startsWith("bestmove")) {
        bestmove = line.split(" ")[1];
        return true;
      }
      return false;
    });
    if (!last) throw new Error("Stockfish gave no evaluation");
    const result: Evaluation = last;
    // The best line should start with the move the engine picked.
    if (bestmove && bestmove !== "(none)" && result.pv[0] !== bestmove) result.pv = [bestmove];
    return result;
  }

  quit() {
    this.onLine = null;
    this.proc.removeAllListeners("exit");
    this.send("quit");
    this.proc.stdin.end();
  }
}
