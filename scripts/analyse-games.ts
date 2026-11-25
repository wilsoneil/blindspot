// Analyses imported games with Stockfish, tags the mistakes and rebuilds the weakness profiles.
//
// Run:  npm run analyse:games -- --minutes 40
//   --minutes N   stop starting new games after N minutes (default 40); the next run carries on
//   --workers N   games analysed side by side (default: one per processor core)
//   --limit N     analyse at most N games (handy for a first try)
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, plus:
//   STOCKFISH_PATH      the Stockfish 17.1 program (default: "stockfish")
//   LICHESS_TAGGER_DIR  the lichess-puzzler/tagger folder
//   PYTHON              Python 3 with python-chess 1.3.0 (default: "python3")
// The GitHub workflow (.github/workflows/analyse-games.yml) sets all of these up.
//
// Newest games are analysed first, one game at a time per worker, and each game is saved as
// soon as it's done, so stopping part-way loses nothing. Output is counts only: logs can be
// public, so no usernames, moves or game details are ever printed.

import { availableParallelism } from "node:os";
import { ANALYSIS_VERSION, ENGINE, scoreColumns } from "../src/lib/analysis/eval";
import { analyseGame, type GameAnalysis } from "../src/lib/analysis/game";
import { readGame } from "../src/lib/analysis/positions";
import { requireDb, type Db } from "../src/lib/db";
import { settingsFromRow, type SettingsRow } from "../src/lib/settings";
import { ANALYSED_TIME_CLASSES, historyStart, rebuildProfiles } from "../src/lib/weakness-store";
import { Stockfish } from "./lib/stockfish";
import { LichessTagger } from "./lib/tagger";

try { process.loadEnvFile(".env.local"); } catch { /* no local file: use the real environment */ }

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : undefined);
const minutes = Math.min(arg("--minutes") ?? 40, 330); // GitHub stops a job after 6 hours
const workers = arg("--workers") ?? availableParallelism();
const limit = arg("--limit") ?? Infinity;

const STOCKFISH = process.env.STOCKFISH_PATH || "stockfish";
const TAGGER_DIR = process.env.LICHESS_TAGGER_DIR;
const PYTHON = process.env.PYTHON || "python3";

interface QueuedGame {
  id: number;
  user_id: string;
  pgn: string;
  colour: "white" | "black";
  opening_name: string | null;
  time_control: string;
  time_class: string;
  played_at: string;
}

async function gamesToAnalyse(db: Db, userId: string, months: number | null): Promise<QueuedGame[]> {
  const start = historyStart(months, new Date())?.toISOString() ?? "1970-01-01T00:00:00Z";
  const out: QueuedGame[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from("games")
      .select("id, user_id, pgn, colour, opening_name, time_control, time_class, played_at")
      .eq("user_id", userId).in("time_class", ANALYSED_TIME_CLASSES).gte("played_at", start)
      .or(`analysis_version.is.null,analysis_version.lt.${ANALYSIS_VERSION}`)
      .order("played_at", { ascending: false }).order("id").range(from, from + 499);
    if (error) throw new Error(`Could not read games: ${error.message}`);
    out.push(...(data as QueuedGame[]));
    if (data.length < 500) return out;
  }
}

async function saveAnalysis(db: Db, game: QueuedGame, a: GameAnalysis) {
  // Mistakes are saved by (game, move) and updated in place on a re-analysis, so a mistake
  // that is still a mistake keeps its id, and with it the user's attempts at it as a
  // "find the move" position, its review schedule and its accepted moves. Ones that no
  // longer count are removed.
  const plies = a.mistakes.map((m) => m.ply);
  let stale = db.from("mistakes").delete().eq("game_id", game.id);
  if (plies.length) stale = stale.not("ply", "in", `(${plies.join(",")})`);
  const del = await stale;
  if (del.error) throw new Error(`Could not clear old mistakes: ${del.error.message}`);
  if (a.mistakes.length) {
    const rows = a.mistakes.map((m) => {
      const before = scoreColumns(m.before);
      const after = scoreColumns(m.after);
      return {
        user_id: game.user_id, game_id: game.id, time_control: game.time_control, time_class: game.time_class,
        played_at: game.played_at, ply: m.ply, move_number: m.moveNumber, fen: m.fen,
        played_uci: m.playedUci, played_san: m.playedSan, best_uci: m.bestUci, best_san: m.bestSan,
        eval_before_cp: before.cp, eval_before_mate: before.mate, eval_after_cp: after.cp, eval_after_mate: after.mate,
        win_chance_drop: m.drop, phase: m.phase, labels: m.labels,
        best_line: m.bestLine.join(" "), refutation: m.refutation.join(" "),
      };
    });
    const ins = await db.from("mistakes").upsert(rows, { onConflict: "game_id,ply" });
    if (ins.error) throw new Error(`Could not save mistakes: ${ins.error.message}`);
  }
  const upd = await db.from("games").update({
    analysed_at: new Date().toISOString(), analysis_version: ANALYSIS_VERSION, analysis_error: null,
    situations: a.situations, opening_family: a.opening.family, opening_variation: a.opening.variation,
  }).eq("id", game.id);
  if (upd.error) throw new Error(`Could not update the game: ${upd.error.message}`);
}

async function markUnreadable(db: Db, game: QueuedGame, e: unknown) {
  // The message comes from the PGN reader; it's kept in the database, not printed.
  const { error } = await db.from("games").update({
    analysis_version: ANALYSIS_VERSION, analysis_error: (e instanceof Error ? e.message : String(e)).slice(0, 500),
  }).eq("id", game.id);
  if (error) throw new Error(error.message);
}

async function main() {
  if (!TAGGER_DIR) throw new Error("LICHESS_TAGGER_DIR must point to the lichess-puzzler/tagger folder (see README).");
  const engineName = await Stockfish.identify(STOCKFISH);
  if (!engineName.startsWith(ENGINE.name)) {
    throw new Error(`Expected ${ENGINE.name}, found "${engineName}". The engine is pinned so scores stay comparable.`);
  }
  console.log(`${engineName}, ${ENGINE.nodes.toLocaleString()} nodes per position, ${workers} workers, up to ${minutes} minutes`);

  const db = requireDb();
  const { data: users, error } = await db.from("settings").select("*").not("chesscom_username", "is", null);
  if (error) throw new Error(`Could not read settings: ${error.message}`);
  if (!users.length) {
    console.log("No chess.com username set yet. Add it on the Settings page and import games first.");
    return;
  }

  const deadline = Date.now() + minutes * 60_000;
  const started = Date.now();
  let analysed = 0, unreadable = 0, mistakes = 0, positions = 0, tagErrors = 0;

  for (const [n, u] of users.entries()) {
    const label = `User ${n + 1}`;
    const settings = settingsFromRow(u as SettingsRow);
    const queue = await gamesToAnalyse(db, u.user_id, settings.historyMonths);
    const total = queue.length;
    console.log(`${label}: ${total} games to analyse`);
    let taken = 0;

    const worker = async () => {
      const engine = await Stockfish.start({ path: STOCKFISH, threads: ENGINE.threads, hashMb: ENGINE.hashMb, nodes: ENGINE.nodes });
      const tagger = LichessTagger.start({ python: PYTHON, taggerDir: TAGGER_DIR, enginePath: STOCKFISH, nodes: ENGINE.nodes });
      try {
        while (Date.now() < deadline && analysed + unreadable < limit) {
          const game = queue.shift();
          if (!game) return;
          taken++;
          try {
            readGame(game.pgn);
          } catch (e) {
            await markUnreadable(db, game, e);
            unreadable++;
            continue;
          }
          const result = await analyseGame({ pgn: game.pgn, colour: game.colour, openingName: game.opening_name }, engine, tagger);
          await saveAnalysis(db, game, result);
          analysed++;
          mistakes += result.mistakes.length;
          positions += result.positions;
          if (analysed % 25 === 0) {
            const perPos = (Date.now() - started) / 1000 / positions * workers;
            console.log(`  ${analysed} games analysed (${perPos.toFixed(2)} s per position per worker)`);
          }
        }
      } finally {
        tagErrors += tagger.errors;
        engine.quit();
        tagger.quit();
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));

    console.log(`${label}: ${taken} games done this run, ${total - taken} still to analyse`);
    const keys = await rebuildProfiles(db, u.user_id, settings);
    console.log(`${label}: weakness profiles rebuilt for ${keys.length} time controls`);
  }

  const mins = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(`Done in ${mins} minutes: ${analysed} games analysed, ${mistakes} mistakes found, ${positions} positions.`);
  if (unreadable) console.log(`${unreadable} games couldn't be read and were set aside.`);
  if (tagErrors) console.log(`The tagger couldn't handle ${tagErrors} lines (those mistakes have no tactical tags).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
