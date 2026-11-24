// Imports new chess.com games and today's ratings into the database.
//
// Run:  npm run import:games
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env.local locally, or GitHub secrets).
//
// Safe to run any number of times: finished months are fetched once, and games that are
// already stored are skipped. Output is counts only: logs can be public, so no usernames
// or game details are ever printed.

import { fetchArchive, fetchArchiveList, fetchRatings, planArchives, toGameRow } from "../src/lib/chesscom";
import { requireDb } from "../src/lib/db";

try { process.loadEnvFile(".env.local"); } catch { /* no local file: use the real environment */ }

const BATCH = 200;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = requireDb();
  const { data: users, error } = await db
    .from("settings")
    .select("user_id, chesscom_username, history_months")
    .not("chesscom_username", "is", null);
  if (error) throw new Error(`Could not read settings: ${error.message}`);
  if (!users.length) {
    console.log("No chess.com username set yet. Add it on the Settings page, then run this again.");
    return;
  }

  for (const [i, u] of users.entries()) {
    const label = `User ${i + 1}`;
    const username = u.chesscom_username as string;

    const { data: done, error: doneErr } = await db
      .from("archive_imports").select("archive_url").eq("user_id", u.user_id).eq("complete", true);
    if (doneErr) throw new Error(doneErr.message);
    const alreadyDone = new Set(done.map((d) => d.archive_url));

    const plan = planArchives(await fetchArchiveList(username), u.history_months, new Date());
    const toFetch = plan.filter((p) => !alreadyDone.has(p.url));
    console.log(`${label}: ${plan.length} months in window, ${toFetch.length} to fetch`);

    let newGames = 0;
    for (const month of toFetch) {
      const rows = (await fetchArchive(month.url))
        .map((g) => toGameRow(g, username, u.user_id))
        .filter((r) => r !== null);

      for (let start = 0; start < rows.length; start += BATCH) {
        const { data: inserted, error: insErr } = await db
          .from("games")
          .upsert(rows.slice(start, start + BATCH), { onConflict: "user_id,source,source_game_id", ignoreDuplicates: true })
          .select("id");
        if (insErr) throw new Error(`Could not save games: ${insErr.message}`);
        newGames += inserted.length;
      }

      const { error: archErr } = await db.from("archive_imports").upsert({
        user_id: u.user_id, archive_url: month.url, game_count: rows.length,
        complete: month.complete, fetched_at: new Date().toISOString(),
      });
      if (archErr) throw new Error(archErr.message);
      await pause(300); // be polite to chess.com: one request at a time
    }
    console.log(`${label}: ${newGames} new games saved`);

    const ratings = await fetchRatings(username);
    const today = new Date().toISOString().slice(0, 10);
    const snapshot = Object.entries(ratings).map(([time_class, rating]) => ({
      user_id: u.user_id, taken_on: today, time_class, rating,
    }));
    if (snapshot.length) {
      const { error: rErr } = await db.from("rating_snapshots").upsert(snapshot);
      if (rErr) throw new Error(rErr.message);
    }
    console.log(`${label}: ratings saved for ${snapshot.length} time controls`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
