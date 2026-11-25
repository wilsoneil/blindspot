import { describe, expect, it } from "vitest";
import { selectBlindspot } from "../src/lib/training/blindspot";
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

describe("selectBlindspot", () => {
  const puzzle = (id: string, labels: string[], rating = 1500) => ({
    id, fen: "8/8/8/8/8/8/8/8 w - - 0 1", moves: "a2a3 a7a6", rating, themes: [], labels,
  });
  const puzzles = [
    ...Array.from({ length: 20 }, (_, i) => puzzle(`f${i}`, ["fork"])),
    ...Array.from({ length: 20 }, (_, i) => puzzle(`p${i}`, ["pin"])),
    puzzle("old1", ["skewer"]), puzzle("old2", ["skewer"]), puzzle("old3", ["fork"]), puzzle("old4", ["pin"]),
  ];
  const queue = ["old1", "old2", "old3", "old4"].map((id, i) => ({
    id: i + 1, user_id: "u1", puzzle_id: id, mistake_id: null, step: 0, due_at: days(i < 3 ? -1 : 2).toISOString(),
  }));
  const attempts = ["old1", "old2", "old3", "old4"].map((id, i) => ({ id: i + 1, user_id: "u1", puzzle_id: id }));

  it("mixes due reviews (at most half) with new puzzles from every weakness", async () => {
    const { db } = fakeDb({ puzzles, review_queue: queue, puzzle_attempts: attempts });
    const got = await selectBlindspot(db, { userId: "u1", weaknesses: [W("fork"), W("pin")], level: 1500, count: 6, now: NOW });
    expect(got).toHaveLength(6);
    const reviews = got.filter((p) => p.review).map((p) => p.id).sort();
    expect(reviews).toEqual(["old1", "old2", "old3"]); // old4 isn't due yet
    const fresh = got.filter((p) => !p.review);
    expect(new Set(fresh.map((p) => p.labels[0]))).toEqual(new Set(["fork", "pin"]));
    expect(fresh.every((p) => !p.id.startsWith("old"))).toBe(true);
  });

  it("skips reviews already served this session, and caps them when many are due", async () => {
    const { db } = fakeDb({ puzzles, review_queue: queue, puzzle_attempts: attempts });
    const got = await selectBlindspot(db, {
      userId: "u1", weaknesses: [W("fork"), W("pin")], level: 1500, count: 2, exclude: ["old1"], now: NOW,
    });
    expect(got.filter((p) => p.review).map((p) => p.id)).toEqual(["old2"]); // half of 2
    expect(got).toHaveLength(2);
  });

  it("serves only reviews when no weakness can be trained with puzzles", async () => {
    const { db } = fakeDb({ puzzles, review_queue: queue, puzzle_attempts: attempts });
    const got = await selectBlindspot(db, { userId: "u1", weaknesses: [], level: 1500, count: 6, now: NOW });
    expect(got.map((p) => p.id).sort()).toEqual(["old1", "old2", "old3"]);
  });
});
