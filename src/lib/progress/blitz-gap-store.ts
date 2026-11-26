// The Blitz gap, worked out by the daily import job and stored as one row (migration 0008),
// so the home page reads one row instead of every game's rating. Ratings only change when
// games are imported, so the stored figures are as fresh as working them out live.
// Server-only.

import type { Db } from "../db";
import { blitzGap, type BlitzGap, type RatingSample } from "./blitz-gap";

const PAGE = 1000;

/** Blitz and daily ratings from every imported game and the daily snapshots. */
export async function readRatingSamples(db: Pick<Db, "from">, userId: string): Promise<RatingSample[]> {
  const samples: RatingSample[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("games").select("played_at, time_class, user_rating")
      .eq("user_id", userId).in("time_class", ["blitz", "daily"]).not("user_rating", "is", null)
      .order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read game ratings: ${error.message}`);
    for (const g of data) samples.push({ timeClass: g.time_class, t: new Date(g.played_at).getTime(), rating: g.user_rating });
    if (data.length < PAGE) break;
  }
  const { data: snaps, error } = await db.from("rating_snapshots").select("taken_on, time_class, rating")
    .eq("user_id", userId).in("time_class", ["blitz", "daily"]);
  if (error) throw new Error(`Could not read rating snapshots: ${error.message}`);
  // A snapshot is the rating when the day's import ran: put it at the start of that day,
  // so games played later the same day come after it.
  for (const r of snaps) samples.push({ timeClass: r.time_class, t: new Date(`${r.taken_on}T00:00:00Z`).getTime(), rating: r.rating });
  return samples;
}

const isMissingTable = (message: string) => /blitz_gaps/.test(message);

/** Works out the gap and stores it (the import job). Skipped with a note before migration 0008. */
export async function saveBlitzGap(db: Pick<Db, "from">, userId: string, now = new Date()): Promise<void> {
  const gap = blitzGap(await readRatingSamples(db, userId), now.getTime());
  const { error } = await db.from("blitz_gaps").upsert({ user_id: userId, computed_at: now.toISOString(), data: gap });
  if (error) {
    if (isMissingTable(error.message)) {
      console.log("Blitz gap not stored: apply migration 0008 to keep it.");
      return;
    }
    throw new Error(`Could not save the Blitz gap: ${error.message}`);
  }
}

/** The stored gap, or worked out live if there is none yet (before the migration or the first import). */
export async function loadBlitzGap(db: Pick<Db, "from">, userId: string, now = new Date()): Promise<BlitzGap | null> {
  const { data, error } = await db.from("blitz_gaps").select("data").eq("user_id", userId).maybeSingle();
  if (!error && data) return data.data as BlitzGap | null;
  if (error && !isMissingTable(error.message)) throw new Error(`Could not read the Blitz gap: ${error.message}`);
  return blitzGap(await readRatingSamples(db, userId), now.getTime());
}
