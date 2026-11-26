import { describe, expect, it } from "vitest";
import { randomId, selectPuzzles, trainingSource } from "../src/lib/training/select";
import { fakeDb } from "./fake-db";

const USER = "user-1";
const OTHER = "user-2";

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** A five-character id spread over the whole range, like Lichess's random ids. */
const spreadId = (i: number) => {
  let n = (i * 104729 + 7) % 62 ** 5;
  return Array.from({ length: 5 }, () => { const c = CHARS[n % 62]; n = Math.floor(n / 62); return c; }).reverse().join("");
};

/** Made-up puzzles with ids spread like Lichess's, ratings and labels as given. */
function puzzles(n: number, rating: (i: number) => number, labels: (i: number) => string[]) {
  return Array.from({ length: n }, (_, i) => ({
    id: spreadId(i),
    fen: "8/8/8/8/8/8/8/8 w - - 0 1",
    moves: "e2e4 e7e5 g1f3",
    rating: rating(i),
    themes: [],
    labels: labels(i),
  }));
}

/** A repeatable stand-in for Math.random. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

describe("trainingSource", () => {
  it("trains a tactic or mate key with its puzzle-store label", () => {
    expect(trainingSource(["fork:missed"])).toEqual({ kind: "puzzles", puzzleLabels: ["fork"] });
    expect(trainingSource(["backRankMate:allowed"])).toEqual({ kind: "puzzles", puzzleLabels: ["backRankMate"] });
  });

  it("trains a pair with puzzles carrying both labels", () => {
    expect(trainingSource(["fork:missed", "rookEndgame"])).toEqual({ kind: "puzzles", puzzleLabels: ["fork", "rookEndgame"] });
  });

  it("uses Lichess equality puzzles for defending a worse position", () => {
    expect(trainingSource(["defending"])).toEqual({ kind: "puzzles", puzzleLabels: ["defending"] });
  });

  it("sends positional labels, alone or in a pair, to the user's own positions", () => {
    expect(trainingSource(["phaseTransition"])).toEqual({ kind: "ownGames" });
    expect(trainingSource(["pawnDecisions", "phaseEndgame"])).toEqual({ kind: "ownGames" });
  });

  it("marks openings and unknown keys as not trainable yet", () => {
    expect(trainingSource(["opening:white:Italian Game"])).toEqual({ kind: "notYet", reason: "opening" });
    expect(trainingSource(["notALabel"])).toEqual({ kind: "notYet", reason: "unknown" });
    expect(trainingSource([])).toEqual({ kind: "notYet", reason: "unknown" });
  });
});

describe("randomId", () => {
  it("is five letters or digits, spread by the random number", () => {
    expect(randomId(() => 0)).toBe("00000");
    expect(randomId(() => 0.9999999)).toBe("zzzzz");
    expect(randomId(Math.random)).toMatch(/^[0-9A-Za-z]{5}$/);
  });
});

describe("selectPuzzles", () => {
  it("returns only puzzles with every label, near the user's level, in random order", async () => {
    // 600 puzzles from 1000 to 2198 (2 points apart); every other one is a fork in a rook endgame.
    const store = puzzles(600, (i) => 1000 + 2 * i, (i) => (i % 2 ? ["fork", "rookEndgame"] : ["fork"]));
    const { db } = fakeDb({ puzzles: store, puzzle_attempts: [] });
    const got = await selectPuzzles(db, { userId: USER, puzzleLabels: ["fork", "rookEndgame"], count: 20, level: 1500, random: seeded() });
    expect(got).toHaveLength(20);
    for (const p of got) {
      expect(p.labels).toEqual(expect.arrayContaining(["fork", "rookEndgame"]));
      expect(Math.abs(p.rating - 1500)).toBeLessThanOrEqual(100);
    }
    expect(new Set(got.map((p) => p.id)).size).toBe(20);
    const ratings = got.map((p) => p.rating);
    expect(ratings).not.toEqual([...ratings].sort((a, b) => a - b)); // shuffled, not in store order
    expect(got[0].moves).toEqual(["e2e4", "e7e5", "g1f3"]);
  });

  it("skips puzzles the user has attempted and ones excluded for this session, but not other users' attempts", async () => {
    const store = puzzles(10, () => 1500, () => ["pin"]);
    const attempts = [
      { id: 1, user_id: USER, puzzle_id: store[0].id },
      { id: 2, user_id: USER, puzzle_id: null }, // an own-game position
      { id: 3, user_id: OTHER, puzzle_id: store[1].id },
    ];
    const { db } = fakeDb({ puzzles: store, puzzle_attempts: attempts });
    const got = await selectPuzzles(db, { userId: USER, puzzleLabels: ["pin"], count: 50, exclude: [store[2].id], random: seeded() });
    const ids = new Set(got.map((p) => p.id));
    expect(ids.size).toBe(8);
    expect(ids.has(store[0].id)).toBe(false);
    expect(ids.has(store[2].id)).toBe(false);
    expect(ids.has(store[1].id)).toBe(true);
  });

  it("widens the rating window step by step until enough puzzles fit", async () => {
    // 5 puzzles within 100 of 1500, 5 more within 200, 5 more within 400, 5 far away.
    const ratings = [1450, 1460, 1500, 1540, 1590, 1350, 1360, 1640, 1650, 1690, 1150, 1200, 1800, 1850, 1890, 600, 700, 2500, 2600, 2700];
    const store = puzzles(ratings.length, (i) => ratings[i], () => ["skewer"]);
    const { db } = fakeDb({ puzzles: store, puzzle_attempts: [] });

    const near = await selectPuzzles(db, { userId: USER, puzzleLabels: ["skewer"], count: 5, level: 1500, random: seeded() });
    expect(near.every((p) => Math.abs(p.rating - 1500) <= 100)).toBe(true);

    const wider = await selectPuzzles(db, { userId: USER, puzzleLabels: ["skewer"], count: 8, level: 1500, random: seeded() });
    expect(wider).toHaveLength(8);
    expect(wider.every((p) => Math.abs(p.rating - 1500) <= 200)).toBe(true);

    const all = await selectPuzzles(db, { userId: USER, puzzleLabels: ["skewer"], count: 100, level: 1500, random: seeded() });
    expect(all).toHaveLength(20); // falls back to any rating, then returns what exists
  });

  it("uses the default level of 1500 when none is given", async () => {
    const store = puzzles(400, (i) => 800 + 5 * i, () => ["fork"]);
    const { db } = fakeDb({ puzzles: store, puzzle_attempts: [] });
    const got = await selectPuzzles(db, { userId: USER, puzzleLabels: ["fork"], count: 10, random: seeded() });
    expect(got.every((p) => Math.abs(p.rating - 1500) <= 100)).toBe(true);
  });

  it("reads a large window in bounded slices instead of loading it all", async () => {
    const store = puzzles(5000, () => 1500, () => ["fork"]);
    const { db, log } = fakeDb({ puzzles: store, puzzle_attempts: [] });
    const got = await selectPuzzles(db, { userId: USER, puzzleLabels: ["fork"], count: 10, random: seeded() });
    expect(got).toHaveLength(10);
    const reads = log.filter((q) => q.table === "puzzles" && !q.head);
    expect(reads.length).toBeLessThanOrEqual(2); // a slice of 200 (two if it started near the end), not all 5,000
  });

  it("reads a small window whole, going round from its random start", async () => {
    const store = puzzles(150, () => 1500, () => ["pin"]);
    for (const r of [() => 0, () => 0.5, () => 0.9999999]) {
      const { db } = fakeDb({ puzzles: store, puzzle_attempts: [] });
      const got = await selectPuzzles(db, { userId: USER, puzzleLabels: ["pin"], count: 150, random: r });
      expect(got).toHaveLength(150);
    }
  });

  it("starts from a different place each time, so sessions differ", async () => {
    const store = puzzles(3000, () => 1500, () => ["fork"]);
    const { db } = fakeDb({ puzzles: store, puzzle_attempts: [] });
    const a = await selectPuzzles(db, { userId: USER, puzzleLabels: ["fork"], count: 5, random: seeded(1) });
    const b = await selectPuzzles(db, { userId: USER, puzzleLabels: ["fork"], count: 5, random: seeded(99) });
    expect(a.map((p) => p.id)).not.toEqual(b.map((p) => p.id));
  });

  it("returns nothing for no labels or a zero count, without reading the store", async () => {
    const { db, log } = fakeDb({ puzzles: puzzles(5, () => 1500, () => ["fork"]), puzzle_attempts: [] });
    expect(await selectPuzzles(db, { userId: USER, puzzleLabels: [], count: 5 })).toEqual([]);
    expect(await selectPuzzles(db, { userId: USER, puzzleLabels: ["fork"], count: 0 })).toEqual([]);
    expect(log).toEqual([]);
  });

  it("stops with a clear error if the attempts or puzzles can't be read", async () => {
    const store = puzzles(5, () => 1500, () => ["fork"]);
    await expect(
      selectPuzzles(fakeDb({ puzzles: store, puzzle_attempts: [] }, { failOn: "puzzle_attempts" }).db, { userId: USER, puzzleLabels: ["fork"], count: 5 }),
    ).rejects.toThrow("Could not read past attempts");
    await expect(
      selectPuzzles(fakeDb({ puzzles: store, puzzle_attempts: [] }, { failOn: "puzzles" }).db, { userId: USER, puzzleLabels: ["fork"], count: 5 }),
    ).rejects.toThrow("Could not read puzzles");
  });
});
