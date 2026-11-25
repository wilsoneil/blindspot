// Recent Drill practice per weakness, for the home page (SPEC.md -> "Weakness profile").

import type { Db } from "../db";

export const RECENT_DAYS = 7;

export interface DrillStat {
  /** Drill puzzles attempted on this weakness in the last RECENT_DAYS days (repeats included). */
  attempted: number;
  /** Of those, solved correctly within the target time. */
  solved: number;
}

/** Drill puzzles per weakness key over the last RECENT_DAYS days. */
export async function recentDrills(db: Pick<Db, "from">, userId: string, now = new Date()): Promise<Record<string, DrillStat>> {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString();
  const { data: attempts, error } = await db.from("puzzle_attempts")
    .select("session_id, correct, solve_ms, target_ms")
    .eq("user_id", userId).eq("mode", "drill").gte("attempted_at", since).limit(5000);
  if (error) throw new Error(`Could not read recent drills: ${error.message}`);
  const rows = attempts as { session_id: number | null; correct: boolean; solve_ms: number; target_ms: number }[];
  const sessionIds = [...new Set(rows.flatMap((r) => (r.session_id === null ? [] : [r.session_id])))];
  if (sessionIds.length === 0) return {};

  const { data: sessions, error: sErr } = await db.from("training_sessions")
    .select("id, weakness_key").eq("user_id", userId).in("id", sessionIds);
  if (sErr) throw new Error(`Could not read recent drills: ${sErr.message}`);
  const keyOf = new Map((sessions as { id: number; weakness_key: string | null }[]).map((s) => [s.id, s.weakness_key]));

  const out: Record<string, DrillStat> = {};
  for (const r of rows) {
    const key = r.session_id === null ? null : keyOf.get(r.session_id);
    if (!key) continue;
    const s = (out[key] ??= { attempted: 0, solved: 0 });
    s.attempted++;
    if (r.correct && r.solve_ms <= r.target_ms) s.solved++;
  }
  return out;
}

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
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: aErr } = await db.from("puzzle_attempts")
      .select("session_id, correct").eq("user_id", userId).in("session_id", ids.slice(i, i + 200)).limit(20000);
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
