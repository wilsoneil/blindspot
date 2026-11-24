// Keeps the stored puzzles in step with the latest puzzle build.

import type { Db } from "./db";

/** Removes stored puzzles that this run didn't keep. Returns how many were removed. */
export async function removeUnselected(db: Pick<Db, "from">, keptIds: Set<string>): Promise<number> {
  // Phase 3 note: once puzzle attempts reference puzzles, attempted ones must be kept.
  const PAGE = 1000;
  const unselected: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("puzzles").select("id").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not list stored puzzles: ${error.message}`);
    for (const row of data) if (!keptIds.has(row.id)) unselected.push(row.id);
    if (data.length < PAGE) break;
  }
  for (let i = 0; i < unselected.length; i += 200) {
    const { error } = await db.from("puzzles").delete().in("id", unselected.slice(i, i + 200));
    if (error) throw new Error(`Could not remove puzzles: ${error.message}`);
  }
  return unselected.length;
}
