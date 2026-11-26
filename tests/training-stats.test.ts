import { describe, expect, it } from "vitest";
import { runStats } from "../src/lib/training/stats";
import { fakeDb } from "./fake-db";

const NOW = new Date("2026-11-25T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("runStats", () => {
  it("scores each past run by puzzles solved, and finds the best, this week's best and the last", async () => {
    const { db } = fakeDb({
      training_sessions: [
        { id: 1, user_id: "u1", mode: "rush", started_at: ago(30) },
        { id: 2, user_id: "u1", mode: "rush", started_at: ago(3) },
        { id: 3, user_id: "u1", mode: "rush", started_at: ago(1) },
        { id: 4, user_id: "u1", mode: "survival", started_at: ago(1) },
        { id: 5, user_id: "u2", mode: "rush", started_at: ago(1) },
      ],
      puzzle_attempts: [
        ...Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, user_id: "u1", session_id: 1, correct: true })),
        ...Array.from({ length: 4 }, (_, i) => ({ id: 200 + i, user_id: "u1", session_id: 2, correct: i < 3 })),
        { id: 300, user_id: "u1", session_id: 3, correct: false },
        ...Array.from({ length: 20 }, (_, i) => ({ id: 400 + i, user_id: "u1", session_id: 4, correct: true })),
        ...Array.from({ length: 50 }, (_, i) => ({ id: 500 + i, user_id: "u2", session_id: 5, correct: true })),
      ],
    });
    expect(await runStats(db, "u1", "rush", NOW)).toEqual({ runs: 3, best: 9, bestThisWeek: 3, last: 0 });
    expect(await runStats(db, "u1", "survival", NOW)).toEqual({ runs: 1, best: 20, bestThisWeek: 20, last: 20 });
  });

  it("has nothing to show before the first run", async () => {
    const { db } = fakeDb({ training_sessions: [], puzzle_attempts: [] });
    expect(await runStats(db, "u1", "rush", NOW)).toEqual({ runs: 0, best: null, bestThisWeek: null, last: null });
  });
});
