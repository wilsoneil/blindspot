import { describe, expect, it } from "vitest";
import type { Db } from "../src/lib/db";
import { removeUnselected } from "../src/lib/puzzle-store";

/** A stand-in for the database's puzzles table that records what gets deleted. */
function fakeDb(storedIds: string[], failDelete = false) {
  const sorted = [...storedIds].sort();
  const deleteCalls: string[][] = [];
  const table = {
    select: () => ({
      order: () => ({
        range: async (from: number, to: number) => ({ data: sorted.slice(from, to + 1).map((id) => ({ id })), error: null }),
      }),
    }),
    delete: () => ({
      in: async (_column: string, ids: string[]) => {
        deleteCalls.push(ids);
        return { error: failDelete ? { message: "boom" } : null };
      },
    }),
  };
  const db = { from: () => table } as unknown as Pick<Db, "from">;
  return { db, deleteCalls };
}

describe("removeUnselected", () => {
  // 2,350 stored puzzles: more than two pages of 1,000.
  const stored = Array.from({ length: 2350 }, (_, i) => `p${String(i).padStart(5, "0")}`);

  it("removes exactly the stored puzzles this run didn't keep, across pages and in small batches", async () => {
    const kept = new Set(stored.filter((_, i) => i % 3 !== 0)); // every third one was not kept
    const { db, deleteCalls } = fakeDb(stored);
    const removed = await removeUnselected(db, kept);
    const deleted = deleteCalls.flat();
    expect(removed).toBe(784);
    expect(deleted.sort()).toEqual(stored.filter((_, i) => i % 3 === 0));
    expect(Math.max(...deleteCalls.map((c) => c.length))).toBeLessThanOrEqual(200);
  });

  it("removes nothing when every stored puzzle was kept", async () => {
    const { db, deleteCalls } = fakeDb(stored);
    expect(await removeUnselected(db, new Set(stored))).toBe(0);
    expect(deleteCalls).toEqual([]);
  });

  it("stops with an error if a removal fails", async () => {
    const { db } = fakeDb(stored, true);
    await expect(removeUnselected(db, new Set())).rejects.toThrow("Could not remove puzzles: boom");
  });
});
