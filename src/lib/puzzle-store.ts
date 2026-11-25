// Keeps the stored puzzles in step with the latest puzzle build.

import type { Db } from "./db";

const PAGE = 1000;

export type RemovalResult = {
  /** Stored puzzles this run didn't select that were removed. */
  removed: number;
  /** Stored puzzles this run didn't select that were kept because they have attempts. */
  keptForAttempts: number;
};

/** Lists every value of one column, a page at a time. */
async function listColumn(db: Pick<Db, "from">, table: string, column: string, what: string): Promise<string[]> {
  const values: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(column)
      .not(column, "is", null)
      .order(column)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not list ${what}: ${error.message}`);
    const rows = data as unknown as Record<string, string>[];
    for (const row of rows) values.push(row[column]);
    if (rows.length < PAGE) break;
  }
  return values;
}

/**
 * Removes stored puzzles that this run didn't keep, except ones with attempts:
 * the attempt history must stay readable (and the database refuses to delete them anyway).
 */
export async function removeUnselected(db: Pick<Db, "from">, keptIds: Set<string>): Promise<RemovalResult> {
  const attempted = new Set(await listColumn(db, "puzzle_attempts", "puzzle_id", "attempted puzzles"));
  const stored = await listColumn(db, "puzzles", "id", "stored puzzles");
  const unselected: string[] = [];
  let keptForAttempts = 0;
  for (const id of stored) {
    if (keptIds.has(id)) continue;
    if (attempted.has(id)) keptForAttempts++;
    else unselected.push(id);
  }
  for (let i = 0; i < unselected.length; i += 200) {
    const { error } = await db.from("puzzles").delete().in("id", unselected.slice(i, i + 200));
    if (error) throw new Error(`Could not remove puzzles: ${error.message}`);
  }
  return { removed: unselected.length, keptForAttempts };
}
