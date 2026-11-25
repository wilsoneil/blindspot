import { describe, expect, it } from "vitest";
import type { Db } from "../src/lib/db";
import { removeUnselected } from "../src/lib/puzzle-store";

/**
 * A stand-in for the database: the puzzles table and the puzzle_attempts table.
 * Records what gets deleted and how big each page read was.
 */
function fakeDb(storedIds: string[], attemptedIds: (string | null)[] = [], fail: "delete" | "attempts" | null = null) {
  const deleteCalls: string[][] = [];
  const columns: Record<string, (string | null)[]> = { puzzles: storedIds, puzzle_attempts: attemptedIds };
  const table = (name: string) => ({
    select: (column: string) => ({
      not: () => ({
        order: () => ({
          range: async (from: number, to: number) => {
            if (name === "puzzle_attempts" && fail === "attempts") return { data: null, error: { message: "no such table" } };
            const values = columns[name].filter((v): v is string => v !== null).sort();
            return { data: values.slice(from, to + 1).map((v) => ({ [column]: v })), error: null };
          },
        }),
      }),
    }),
    delete: () => ({
      in: async (_column: string, ids: string[]) => {
        deleteCalls.push(ids);
        return { error: fail === "delete" ? { message: "boom" } : null };
      },
    }),
  });
  const db = { from: (name: string) => table(name) } as unknown as Pick<Db, "from">;
  return { db, deleteCalls };
}

describe("removeUnselected", () => {
  // 2,350 stored puzzles: more than two pages of 1,000.
  const stored = Array.from({ length: 2350 }, (_, i) => `p${String(i).padStart(5, "0")}`);

  it("removes exactly the stored puzzles this run didn't keep, across pages and in small batches", async () => {
    const kept = new Set(stored.filter((_, i) => i % 3 !== 0)); // every third one was not kept
    const { db, deleteCalls } = fakeDb(stored);
    const result = await removeUnselected(db, kept);
    const deleted = deleteCalls.flat();
    expect(result).toEqual({ removed: 784, keptForAttempts: 0 });
    expect(deleted.sort()).toEqual(stored.filter((_, i) => i % 3 === 0));
    expect(Math.max(...deleteCalls.map((c) => c.length))).toBeLessThanOrEqual(200);
  });

  it("keeps unselected puzzles that have attempts, even with many attempts across pages", async () => {
    const kept = new Set(stored.slice(100)); // the first 100 were not selected
    // Two of the unselected ones were attempted, one of them many times; plus attempts at
    // selected puzzles and own-game positions (no puzzle id).
    const attempts = [...Array(1500).fill(stored[5]), stored[42], stored[500], null, null];
    const { db, deleteCalls } = fakeDb(stored, attempts);
    const result = await removeUnselected(db, kept);
    expect(result).toEqual({ removed: 98, keptForAttempts: 2 });
    const deleted = new Set(deleteCalls.flat());
    expect(deleted.has(stored[5])).toBe(false);
    expect(deleted.has(stored[42])).toBe(false);
    expect(deleted.has(stored[0])).toBe(true);
  });

  it("removes nothing when every stored puzzle was kept", async () => {
    const { db, deleteCalls } = fakeDb(stored, [stored[0]]);
    expect(await removeUnselected(db, new Set(stored))).toEqual({ removed: 0, keptForAttempts: 0 });
    expect(deleteCalls).toEqual([]);
  });

  it("stops before removing anything if the attempts can't be read", async () => {
    const { db, deleteCalls } = fakeDb(stored, [], "attempts");
    await expect(removeUnselected(db, new Set())).rejects.toThrow("Could not list attempted puzzles: no such table");
    expect(deleteCalls).toEqual([]);
  });

  it("stops with an error if a removal fails", async () => {
    const { db } = fakeDb(stored, [], "delete");
    await expect(removeUnselected(db, new Set())).rejects.toThrow("Could not remove puzzles: boom");
  });
});
