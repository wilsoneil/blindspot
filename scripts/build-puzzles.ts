// Builds the puzzle store from the Lichess puzzle database (one-off; re-run to refresh).
//
//   npm run build:puzzles                         download from Lichess and save to the database
//   npm run build:puzzles -- --dry-run            download and report counts, save nothing
//   npm run build:puzzles -- --file path.csv.zst  use a local copy (.csv or .csv.zst)
//   zstd -dc file.csv.zst | npm run build:puzzles -- --file -   read the CSV from a pipe
//                                                   (what the GitHub workflow does)
//
// The ~900 MB file is streamed and filtered line by line; it is never stored in full.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY unless --dry-run.

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { requireDb, type Db } from "../src/lib/db";
import { LABELS } from "../src/lib/labels";
import { readLines } from "../src/lib/lines";
import { parsePuzzleLine, PuzzleFilter, type PuzzleRow } from "../src/lib/puzzles";

try { process.loadEnvFile(".env.local"); } catch { /* no local file: use the real environment */ }

const LICHESS_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const BATCH = 1000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArg = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;

/** The raw file, from disk or straight from Lichess. readLines unpacks it if needed. */
async function openSource(): Promise<AsyncIterable<Uint8Array>> {
  if (fileArg === "-") return process.stdin;
  if (fileArg) return createReadStream(fileArg);
  console.log("Downloading the Lichess puzzle database...");
  const res = await fetch(LICHESS_URL);
  if (!res.ok || !res.body) throw new Error(`Lichess download failed: ${res.status}`);
  console.log(`  content type: ${res.headers.get("content-type")}, encoding: ${res.headers.get("content-encoding") ?? "none"}`);
  return Readable.fromWeb(res.body as unknown as NodeWebStream<Uint8Array>);
}

async function save(db: Db, rows: PuzzleRow[]) {
  const { error } = await db.from("puzzles").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`Could not save puzzles: ${error.message}`);
}

async function main() {
  const db = dryRun ? null : requireDb();
  const filter = new PuzzleFilter();
  let batch: PuzzleRow[] = [];
  const started = Date.now();

  let lines = 0;
  for await (const line of readLines(await openSource())) {
    lines++;
    const puzzle = parsePuzzleLine(line);
    // Keep reading to the end even once the store is full, so a program feeding
    // this script through a pipe isn't cut off mid-file (which would look like a failure).
    if (!puzzle || !filter.accept(puzzle)) continue;
    batch.push(puzzle);
    if (batch.length >= BATCH) {
      if (db) await save(db, batch);
      batch = [];
    }
    if (filter.seen % 500_000 === 0) {
      console.log(`  ${filter.seen.toLocaleString()} read, ${filter.kept.toLocaleString()} kept`);
    }
  }
  if (db && batch.length) await save(db, batch);

  // A real run reads millions of lines. Almost none means the download wasn't the puzzle file.
  if (filter.seen < 1000) {
    throw new Error(`Only ${lines} lines and ${filter.seen} puzzles read: the file doesn't look like the Lichess puzzle database.`);
  }

  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s: ${filter.seen.toLocaleString()} read, ${filter.kept.toLocaleString()} kept${dryRun ? " (dry run, nothing saved)" : ""}.`);
  console.log("Puzzles per label:");
  for (const label of LABELS) {
    if (label.lichessThemes.length === 0) continue;
    const n = filter.perLabel.get(label.id) ?? 0;
    console.log(`  ${label.name.padEnd(30)} ${n.toLocaleString().padStart(8)}${n === 0 ? "   <- none found: check the theme name" : ""}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
