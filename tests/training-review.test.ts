import { describe, expect, it } from "vitest";
import { CHUNK, placeReviews, REVIEWS_PER_CHUNK, selectRunPuzzles } from "../src/lib/training/run";
import { dueReviews, INTERVAL_DAYS, nextReview, updateReview } from "../src/lib/training/review";
import { fakeDb } from "./fake-db";

/** A weakness trained by Lichess puzzles with one label. */
const W = (label: string) => ({ key: `${label}:missed`, kind: "puzzles" as const, puzzleLabels: [label] });

const NOW = new Date("2026-11-25T12:00:00Z");
const DAY = 86_400_000;
const days = (n: number) => new Date(NOW.getTime() + n * DAY);

describe("nextReview", () => {
  it("puts a failed or slow puzzle on the queue for tomorrow", () => {
    expect(nextReview(null, false, NOW)).toEqual({ kind: "added", dueAt: days(1) });
  });

  it("leaves a clean solve of a puzzle that isn't on the queue alone", () => {
    expect(nextReview(null, true, NOW)).toEqual({ kind: "unchanged" });
  });

  it("moves a due puzzle through 1, 3, 7 and 21 days, then off the queue", () => {
    expect(INTERVAL_DAYS).toEqual([1, 3, 7, 21]);
    expect(nextReview({ step: 0, dueAt: NOW }, true, NOW)).toEqual({ kind: "advanced", step: 1, dueAt: days(3) });
    expect(nextReview({ step: 1, dueAt: NOW }, true, NOW)).toEqual({ kind: "advanced", step: 2, dueAt: days(7) });
    expect(nextReview({ step: 2, dueAt: NOW }, true, NOW)).toEqual({ kind: "advanced", step: 3, dueAt: days(21) });
    expect(nextReview({ step: 3, dueAt: NOW }, true, NOW)).toEqual({ kind: "graduated" });
  });

  it("doesn't let a clean solve before the due date move it on", () => {
    expect(nextReview({ step: 0, dueAt: days(1) }, true, NOW)).toEqual({ kind: "unchanged" });
  });

  it("sends any failure back to 1 day, due or not", () => {
    expect(nextReview({ step: 2, dueAt: NOW }, false, NOW)).toEqual({ kind: "reset", dueAt: days(1) });
    expect(nextReview({ step: 3, dueAt: days(10) }, false, NOW)).toEqual({ kind: "reset", dueAt: days(1) });
  });
});

describe("updateReview and dueReviews", () => {
  it("adds, advances, resets and removes queue entries, per user", async () => {
    const tables = { review_queue: [] as Record<string, unknown>[] };
    const { db } = fakeDb(tables);
    await updateReview(db, "u1", { puzzleId: "p1" }, false, NOW);
    await updateReview(db, "u2", { puzzleId: "p1" }, false, NOW);
    expect(tables.review_queue).toHaveLength(2);
    expect(tables.review_queue[0]).toMatchObject({ user_id: "u1", puzzle_id: "p1", step: 0, due_at: days(1).toISOString() });

    expect(await dueReviews(db, "u1", 10, NOW)).toEqual([]);
    expect(await dueReviews(db, "u1", 10, days(1))).toEqual([{ puzzleId: "p1" }]);

    expect((await updateReview(db, "u1", { puzzleId: "p1" }, true, days(1))).kind).toBe("advanced");
    expect(tables.review_queue[0]).toMatchObject({ step: 1, due_at: days(4).toISOString() });
    expect((await updateReview(db, "u1", { puzzleId: "p1" }, false, days(2))).kind).toBe("reset");
    expect(tables.review_queue[0]).toMatchObject({ step: 0, due_at: days(3).toISOString() });

    tables.review_queue[0].step = 3;
    expect((await updateReview(db, "u1", { puzzleId: "p1" }, true, days(5))).kind).toBe("graduated");
    expect(tables.review_queue.map((r) => r.user_id)).toEqual(["u2"]);
  });
});

describe("reviews in Rush and Survival", () => {
  const puzzle = (id: string, labels: string[], rating = 1500) => ({
    id, fen: "8/8/8/8/8/8/8/8 w - - 0 1", moves: "a2a3 a7a6", rating, themes: [], labels,
  });
  // Plenty of new puzzles across the ladder, and four earlier misses (three due) at 1040, 1220, 1400, 1300.
  const puzzles = [
    ...Array.from({ length: 60 }, (_, i) => puzzle(`f${i}`, ["fork"], 1000 + 20 * i)),
    ...Array.from({ length: 60 }, (_, i) => puzzle(`p${i}`, ["pin"], 1000 + 20 * i)),
    puzzle("old1", ["skewer"], 1040), puzzle("old2", ["skewer"], 1220), puzzle("old3", ["fork"], 1400), puzzle("old4", ["pin"], 1300),
  ];
  const queue = ["old1", "old2", "old3", "old4"].map((id, i) => ({
    id: i + 1, user_id: "u1", puzzle_id: id, mistake_id: null, step: 0, due_at: days(i < 3 ? -1 : 2).toISOString(),
  }));
  const attempts = ["old1", "old2", "old3", "old4"].map((id, i) => ({ id: i + 1, user_id: "u1", puzzle_id: id }));
  const run = (o: { exclude?: string[]; chunks?: number } = {}) => {
    const { db } = fakeDb({ puzzles, review_queue: queue, puzzle_attempts: attempts });
    return selectRunPuzzles(db, {
      userId: "u1", weaknesses: [W("fork"), W("pin")], level: 1500, fromChunk: 0, chunks: o.chunks ?? 3, exclude: o.exclude, now: NOW,
    });
  };

  it("brings back due misses, at most a third of each group, among new puzzles", async () => {
    const got = await run({ chunks: 5 });
    expect(got.filter((p) => p.review).map((p) => p.id).sort()).toEqual(["old1", "old2", "old3"]); // old4 isn't due
    for (let c = 0; c < 5; c++) {
      const chunk = got.slice(c * CHUNK, (c + 1) * CHUNK);
      expect(chunk).toHaveLength(CHUNK);
      expect(chunk.filter((p) => p.review).length).toBeLessThanOrEqual(REVIEWS_PER_CHUNK);
    }
    expect(got.filter((p) => !p.review).every((p) => !p.id.startsWith("old"))).toBe(true);
  });

  it("places each review in the group matching its difficulty, keeping the group easiest first", async () => {
    const got = await run({ chunks: 5 });
    const chunkOf = (id: string) => Math.floor(got.findIndex((p) => p.id === id) / CHUNK);
    // Survival's groups centre on about 1038, 1128, 1218, 1308, 1398: old1 (1040) fits the
    // first, old2 (1220) the third, old3 (1400) the fifth.
    expect(chunkOf("old1")).toBe(0);
    expect(chunkOf("old2")).toBe(2);
    expect(chunkOf("old3")).toBe(4);
    for (let c = 0; c < 5; c++) {
      const r = got.slice(c * CHUNK, (c + 1) * CHUNK).map((p) => p.rating);
      expect(r).toEqual([...r].sort((a, b) => a - b));
    }
  });

  it("keeps a hard review for later when the run hasn't climbed that high yet", async () => {
    const got = await run({ chunks: 2 });
    expect(got.some((p) => p.id === "old3")).toBe(false);
  });

  it("puts reviews in the next group when one is full, oldest first, and easy ones in the first group fetched", () => {
    const r = (id: string, rating: number) => ({ id, fen: "", moves: [], rating, themes: [], labels: [], review: true });
    const placed = placeReviews([r("a", 1250), r("b", 1260), r("c", 1270), r("d", 600)], 1500, 3, 2);
    expect([...placed.entries()].map(([c, l]) => [c, l.map((x) => x.id)])).toEqual([[3, ["a", "b"]], [4, ["c", "d"]]]);
  });

  it("still finds an easier due review behind a backlog of older, harder ones", async () => {
    const hard = Array.from({ length: 30 }, (_, i) => puzzle(`hard${i}`, ["skewer"], 2400));
    const easy = puzzle("easy", ["skewer"], 1040);
    const backlog = [...hard, easy].map((p, i) => ({
      id: 100 + i, user_id: "u1", puzzle_id: p.id, mistake_id: null, step: 0, due_at: days(-40 + i).toISOString(),
    }));
    const { db } = fakeDb({
      puzzles: [...puzzles, ...hard, easy], review_queue: backlog,
      puzzle_attempts: backlog.map((q) => ({ id: q.id, user_id: "u1", puzzle_id: q.puzzle_id })),
    });
    const got = await selectRunPuzzles(db, {
      userId: "u1", weaknesses: [W("fork"), W("pin")], level: 1500, fromChunk: 0, chunks: 2, now: NOW,
    });
    expect(got.filter((p) => p.review).map((p) => p.id)).toEqual(["easy"]);
  });

  it("skips reviews already served in this run", async () => {
    const got = await run({ exclude: ["old1"], chunks: 1 });
    expect(got.some((p) => p.id === "old1")).toBe(false);
  });
});
