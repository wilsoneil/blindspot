// Runs the Lichess puzzle tagger (Python) as a helper process: one line of JSON in,
// one line of JSON out. See scripts/tagger/tag.py.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Tagger, TaggerInput } from "../../src/lib/analysis/game";

export interface TaggerOptions {
  python: string;
  taggerDir: string; // the lichess-puzzler/tagger folder
  enginePath?: string; // for the zugzwang check
  nodes?: number;
}

export class LichessTagger implements Tagger {
  private waiting: { resolve: (themes: string[]) => void; reject: (e: Error) => void }[] = [];
  private failed: Error | null = null;
  /** Lines the tagger couldn't handle (they get no tactical tags). */
  errors = 0;

  private constructor(private proc: ChildProcessWithoutNullStreams) {
    createInterface({ input: proc.stdout }).on("line", (line) => {
      const next = this.waiting.shift();
      if (!next) return;
      try {
        const out = JSON.parse(line) as { themes?: string[]; error?: string };
        if (out.error) this.errors++;
        next.resolve(out.themes ?? []);
      } catch {
        next.reject(new Error("The tagger gave an unreadable answer"));
      }
    });
    // The tagger's own messages go to the log (they never contain game details).
    proc.stderr.on("data", (d) => process.stderr.write(d));
    const fail = (e: Error) => {
      this.failed = e;
      for (const w of this.waiting.splice(0)) w.reject(e);
    };
    proc.on("error", fail);
    proc.on("exit", (code) => fail(new Error(`The tagger stopped (exit code ${code})`)));
  }

  static start(o: TaggerOptions): LichessTagger {
    const args = ["-I", "scripts/tagger/tag.py", "--tagger", o.taggerDir];
    if (o.enginePath) args.push("--engine", o.enginePath, "--nodes", String(o.nodes ?? 300_000));
    return new LichessTagger(spawn(o.python, args, { stdio: "pipe" }));
  }

  tag(input: TaggerInput): Promise<string[]> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.proc.stdin.write(JSON.stringify(input) + "\n");
    });
  }

  quit() {
    this.proc.removeAllListeners("exit");
    this.proc.stdin.end();
  }
}
