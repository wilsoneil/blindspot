// Builds the puzzle store from the Lichess puzzle database (one-off; re-run to refresh).
//
//   npm run build:puzzles                         download from Lichess and save to the database
//   npm run build:puzzles -- --dry-run            download and report counts, save nothing
//   npm run build:puzzles -- --file path.csv.zst  use a local copy (.csv or .csv.zst)
//
// The ~900 MB file is streamed and filtered line by line; it is never stored in full.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY unless --dry-run.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createZstdDecompress } from "node:zlib";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { requireDb, type Db } from "../src/lib/db";
import { LABELS } from "../src/lib/labels";
import { parsePuzzleLine, PuzzleFilter, type PuzzleRow } from "../src/lib/puzzles";

try { process.loadEnvFile(".env.local"); } catch { /* no local file: use the real environment */ }

const LICHESS_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const BATCH = 1000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArg = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;

async function openSource(): Promise<NodeJS.ReadableStream> {
  let raw: NodeJS.ReadableStream;
  let compressed: boolean;
  if (fileArg) {
    raw = createReadStream(fileArg);
    compressed = fileArg.endsWith(".zst");
  } else {
    console.log("Downloading the Lichess puzzle database...");
    const res = await fetch(LICHESS_URL);
    if (!res.ok || !res.body) throw new Error(`Lichess download failed: ${res.status}`);
    raw = Readable.fromWeb(res.body as unknown as WebReadableStream);
    compressed = true;
  }
  return compressed ? raw.pipe(createZstdDecompress()) : raw;
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

  const lines = createInterface({ input: await openSource(), crlfDelay: Infinity });
  for await (const line of lines) {
    const puzzle = parsePuzzleLine(line);
    if (!puzzle || !filter.accept(puzzle)) {
      if (filter.isFull()) break;
      continue;
    }
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
