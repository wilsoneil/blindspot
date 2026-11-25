// Works out the accepted moves and subtlety of each stored mistake, for the "find the move"
// drills (SPEC.md -> "Training modes"; method in src/lib/analysis/accepted.ts).
//
// Run:  npm run find:moves -- --minutes 20
//   --minutes N   stop after N minutes (default 20); the next run carries on
//   --workers N   positions worked on side by side (default: one per processor core)
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and STOCKFISH_PATH (Stockfish 17.1), as the
// analysis job. The "Analyse games" workflow runs it after each analysis.
// Output is counts only: no positions or moves are printed.

import { availableParallelism } from "node:os";
import { acceptedMoves, POSITIONS_VERSION, TOP_MOVES } from "../src/lib/analysis/accepted";
import { ENGINE } from "../src/lib/analysis/eval";
import { requireDb } from "../src/lib/db";
import { Stockfish } from "./lib/stockfish";

try { process.loadEnvFile(".env.local"); } catch { /* no local file: use the real environment */ }

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : undefined);
const minutes = Math.min(arg("--minutes") ?? 20, 330);
const workers = arg("--workers") ?? availableParallelism();
const STOCKFISH = process.env.STOCKFISH_PATH || "stockfish";

async function main() {
  const db = requireDb();
  const deadline = Date.now() + minutes * 60_000;

  const todo: { id: number; fen: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("mistakes").select("id, fen")
      .or(`accepted_moves.is.null,positions_version.lt.${POSITIONS_VERSION}`)
      .order("played_at", { ascending: false }).order("id").range(from, from + 999);
    if (error) {
      if (/accepted_moves|positions_version/.test(error.message)) {
        console.log("Migration 0006 hasn't been applied yet: skipping (see supabase/migrations/0006_positions.sql).");
        return;
      }
      throw new Error(`Could not read mistakes: ${error.message}`);
    }
    todo.push(...(data as { id: number; fen: string }[]));
    if (data.length < 1000) break;
  }
  console.log(`${todo.length} positions to work out, ${workers} workers, up to ${minutes} minutes`);
  if (!todo.length) return;

  const engineName = await Stockfish.identify(STOCKFISH);
  if (!engineName.startsWith(ENGINE.name)) throw new Error(`Expected ${ENGINE.name}, found "${engineName}".`);

  let done = 0;
  const worker = async () => {
    const engine = await Stockfish.start({ path: STOCKFISH, threads: ENGINE.threads, hashMb: ENGINE.hashMb, nodes: ENGINE.nodes });
    try {
      while (Date.now() < deadline) {
        const m = todo.shift();
        if (!m) return;
        const { accepted, subtlety } = acceptedMoves(await engine.topMoves(m.fen, TOP_MOVES));
        const { error } = await db.from("mistakes")
          .update({ accepted_moves: accepted, subtlety, positions_version: POSITIONS_VERSION }).eq("id", m.id);
        if (error) throw new Error(`Could not save a position: ${error.message}`);
        if (++done % 100 === 0) console.log(`  ${done} done`);
      }
    } finally {
      engine.quit();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));
  console.log(`Done: ${done} positions worked out, ${todo.length} still to do.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
