import { describe, expect, it } from "vitest";
import { CHUNK, chunkWeaknesses, ladderRating, mixedWeaknesses, selectRunPuzzles, shuffled } from "../src/lib/training/run";
import { fakeDb } from "./fake-db";

/** A weakness trained by Lichess puzzles with one label. */
const W = (label: string) => ({ key: `${label}:missed`, kind: "puzzles" as const, puzzleLabels: [label] });

function seeded(seed = 7) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Made-up puzzles for each label, rated 800 to 2600 in steps of 10. */
function store(labels: string[]) {
  return labels.flatMap((label) =>
    Array.from({ length: 181 }, (_, i) => ({
      id: `${label}${String(i).padStart(3, "0")}`, fen: "8/8/8/8/8/8/8/8 w - - 0 1", moves: "a2a3 a7a6",
      rating: 800 + 10 * i, themes: [], labels: [label],
    })));
}

describe("the ladder", () => {
  it("starts 300 below the user's level and rises 25 per puzzle", () => {
    expect(ladderRating(1500, 0)).toBe(1200);
    expect(ladderRating(1500, 12)).toBe(1500);
    expect(ladderRating(1500, 20)).toBe(1700);
  });

  it("cycles through the weaknesses, a few per chunk", () => {
    expect(chunkWeaknesses(5, 0)).toEqual([0, 1, 2]);
    expect(chunkWeaknesses(5, 1)).toEqual([3, 4, 0]);
    expect(chunkWeaknesses(2, 0)).toEqual([0, 1]);
    expect(chunkWeaknesses(1, 3)).toEqual([0]);
    expect(chunkWeaknesses(0, 0)).toEqual([]);
  });
});

describe("selectRunPuzzles", () => {
  it("mixes weaknesses within each chunk and gets harder chunk by chunk", async () => {
    const { db } = fakeDb({ puzzles: store(["fork", "pin", "skewer"]), puzzle_attempts: [] });
    const got = await selectRunPuzzles(db, {
      userId: "u1", weaknesses: [W("fork"), W("pin"), W("skewer")], level: 1500, fromChunk: 0, chunks: 3, random: seeded(),
    });
    expect(got).toHaveLength(3 * CHUNK);
    expect(new Set(got.map((p) => p.id)).size).toBe(got.length);
    const chunks = [0, 1, 2].map((c) => got.slice(c * CHUNK, (c + 1) * CHUNK));
    for (const c of chunks) {
      expect(new Set(c.map((p) => p.labels[0])).size).toBe(3); // all three weaknesses
      expect(c.map((p) => p.rating)).toEqual([...c.map((p) => p.rating)].sort((a, b) => a - b)); // easiest first
    }
    const avg = (c: typeof got) => c.reduce((s, p) => s + p.rating, 0) / c.length;
    expect(avg(chunks[0])).toBeLessThan(avg(chunks[1]));
    expect(avg(chunks[1])).toBeLessThan(avg(chunks[2]));
    expect(Math.abs(avg(chunks[0]) - ladderRating(1500, 2.5))).toBeLessThan(120);
  });

  it("skips attempted and excluded puzzles, and never repeats one", async () => {
    const puzzles = store(["fork"]);
    const attempted = puzzles.filter((p) => p.rating >= 1100 && p.rating <= 1300).map((p, i) => ({ id: i, user_id: "u1", puzzle_id: p.id }));
    const { db } = fakeDb({ puzzles, puzzle_attempts: attempted });
    const got = await selectRunPuzzles(db, {
      userId: "u1", weaknesses: [W("fork")], level: 1500, fromChunk: 0, chunks: 2, exclude: ["fork045"], random: seeded(),
    });
    const ids = got.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("fork045");
    for (const a of attempted) expect(ids).not.toContain(a.puzzle_id);
  });

  it("returns nothing without weaknesses", async () => {
    const { db } = fakeDb({ puzzles: [], puzzle_attempts: [] });
    expect(await selectRunPuzzles(db, { userId: "u1", weaknesses: [], level: 1500, fromChunk: 0, chunks: 2 })).toEqual([]);
  });
});

describe("mixedWeaknesses", () => {
  it("keeps the shown weaknesses that can be trained, with puzzles or the user's own positions", () => {
    const top = [
      { key: "fork:missed", labels: ["fork:missed"] },
      { key: "phaseTransition", labels: ["phaseTransition"] },
      { key: "opening:white:Italian Game", labels: ["opening:white:Italian Game"] },
      { key: "pin:allowed+rookEndgame", labels: ["pin:allowed", "rookEndgame"] },
      { key: "skewer:missed", labels: ["skewer:missed"] },
    ];
    expect(mixedWeaknesses(top, 4)).toEqual([
      { key: "fork:missed", kind: "puzzles", puzzleLabels: ["fork"] },
      { key: "phaseTransition", kind: "ownGames", labelKeys: ["phaseTransition"] },
      { key: "pin:allowed+rookEndgame", kind: "puzzles", puzzleLabels: ["pin", "rookEndgame"] },
    ]);
  });
});

describe("shuffled", () => {
  it("returns the same items in a new order without changing the original", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffled(items, seeded());
    expect([...out].sort()).toEqual(items);
    expect(out).not.toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
