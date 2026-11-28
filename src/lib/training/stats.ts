// Rush and Survival run stats for their start pages (SPEC.md -> "Training modes").

import type { Db } from "../db";

/** "This week" for the best score this week. */
export const RECENT_DAYS = 7;

export interface RunStats {
  runs: number;
  /** Most puzzles solved in one run (the score shown during a run: correct, any time). */
  best: number | null;
  bestThisWeek: number | null;
  last: number | null;
}

/** Past Rush or Survival runs: one training session each, scored by puzzles solved. */
export async function runStats(db: Pick<Db, "from">, userId: string, mode: "rush" | "survival", now = new Date()): Promise<RunStats> {
  const { data: sessions, error } = await db.from("training_sessions")
    .select("id, started_at").eq("user_id", userId).eq("mode", mode).order("started_at").limit(2000);
  if (error) throw new Error(`Could not read past runs: ${error.message}`);
  const list = sessions as { id: number; started_at: string }[];
  if (list.length === 0) return { runs: 0, best: null, bestThisWeek: null, last: null };

  const score = new Map(list.map((s) => [s.id, 0]));
  const ids = list.map((s) => s.id);
  const batches = [];
  for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200));
  const results = await Promise.all(batches.map(async (batch) =>
    db.from("puzzle_attempts").select("session_id, correct").eq("user_id", userId).in("session_id", batch).limit(20000)));
  for (const { data, error: aErr } of results) {
    if (aErr) throw new Error(`Could not read past runs: ${aErr.message}`);
    for (const a of data as { session_id: number; correct: boolean }[]) {
      if (a.correct) score.set(a.session_id, (score.get(a.session_id) ?? 0) + 1);
    }
  }

  const since = now.getTime() - RECENT_DAYS * 86_400_000;
  const all = list.map((s) => score.get(s.id)!);
  const week = list.filter((s) => new Date(s.started_at).getTime() >= since).map((s) => score.get(s.id)!);
  return {
    runs: list.length,
    best: Math.max(...all),
    bestThisWeek: week.length ? Math.max(...week) : null,
    last: all[all.length - 1],
  };
}
