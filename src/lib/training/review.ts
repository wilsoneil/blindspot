// The spaced-repetition queue (SPEC.md -> "Training modes"): failed or slow puzzles come back
// in Rush and Survival runs after 1, 3, 7, then 21 days.
//
//   - A failure or slow solve (any mode) puts the puzzle on the queue, due in 1 day.
//   - A clean solve of a puzzle that is due moves it to the next step; after the 21-day step
//     it leaves the queue. Clean solves before it's due (e.g. "Try again" straight after
//     failing) don't move it, so the schedule can't be rushed.

import type { Db } from "../db";
import { check } from "../read-all";

export const INTERVAL_DAYS = [1, 3, 7, 21];
const DAY = 86_400_000;

export type ReviewChange =
  | { kind: "added"; dueAt: Date }
  | { kind: "reset"; dueAt: Date }
  | { kind: "advanced"; step: number; dueAt: Date }
  | { kind: "graduated" }
  | { kind: "unchanged" };

/** What happens to a puzzle's queue entry after an attempt (pure). */
export function nextReview(entry: { step: number; dueAt: Date } | null, fullySolved: boolean, now: Date): ReviewChange {
  if (!fullySolved) {
    const dueAt = new Date(now.getTime() + INTERVAL_DAYS[0] * DAY);
    return entry ? { kind: "reset", dueAt } : { kind: "added", dueAt };
  }
  if (!entry || entry.dueAt > now) return { kind: "unchanged" };
  if (entry.step >= INTERVAL_DAYS.length - 1) return { kind: "graduated" };
  const step = entry.step + 1;
  return { kind: "advanced", step, dueAt: new Date(now.getTime() + INTERVAL_DAYS[step] * DAY) };
}

/** A Lichess puzzle or one of the user's own positions (a stored mistake). */
export type ReviewItem = { puzzleId: string } | { mistakeId: number };

const column = (item: ReviewItem) =>
  "puzzleId" in item ? { name: "puzzle_id", value: item.puzzleId } : { name: "mistake_id", value: item.mistakeId };

/** Applies an attempt's result to the queue. */
export async function updateReview(
  db: Pick<Db, "from">, userId: string, item: ReviewItem, fullySolved: boolean, now = new Date(),
): Promise<ReviewChange> {
  const col = column(item);
  const { data, error } = await db.from("review_queue")
    .select("id, step, due_at").eq("user_id", userId).eq(col.name, col.value).maybeSingle();
  check(error, "read the review queue");
  const row = data as { id: number; step: number; due_at: string } | null;
  const change = nextReview(row ? { step: row.step, dueAt: new Date(row.due_at) } : null, fullySolved, now);
  const stamp = now.toISOString();
  switch (change.kind) {
    case "added": {
      const { error: e } = await db.from("review_queue").insert({
        user_id: userId, [col.name]: col.value, step: 0, due_at: change.dueAt.toISOString(), updated_at: stamp,
      });
      check(e, "add to the review queue");
      break;
    }
    case "reset":
    case "advanced": {
      const step = change.kind === "reset" ? 0 : change.step;
      const { error: e } = await db.from("review_queue")
        .update({ step, due_at: change.dueAt.toISOString(), updated_at: stamp }).eq("id", row!.id);
      check(e, "update the review queue");
      break;
    }
    case "graduated": {
      const { error: e } = await db.from("review_queue").delete().eq("id", row!.id);
      check(e, "update the review queue");
      break;
    }
  }
  return change;
}

/** Puzzles and positions due for review now, soonest first. */
export async function dueReviews(db: Pick<Db, "from">, userId: string, limit: number, now = new Date()): Promise<ReviewItem[]> {
  const { data, error } = await db.from("review_queue")
    .select("puzzle_id, mistake_id, due_at").eq("user_id", userId)
    .lte("due_at", now.toISOString()).order("due_at").limit(limit);
  check(error, "read the review queue");
  return (data as { puzzle_id: string | null; mistake_id: number | null }[])
    .map((r) => (r.puzzle_id ? { puzzleId: r.puzzle_id } : { mistakeId: r.mistake_id! }));
}
