import { describe, expect, it } from "vitest";
import { recentDrills } from "../src/lib/training/stats";
import { fakeDb } from "./fake-db";

const NOW = new Date("2026-11-25T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("recentDrills", () => {
  it("counts this week's Drill puzzles per weakness, and how many were solved within target time", async () => {
    const attempt = (id: number, o: Record<string, unknown>) => ({
      id, user_id: "u1", mode: "drill", session_id: 1, correct: true, solve_ms: 10_000, target_ms: 30_000, attempted_at: ago(1), ...o,
    });
    const { db } = fakeDb({
      training_sessions: [
        { id: 1, user_id: "u1", mode: "drill", weakness_key: "fork:missed" },
        { id: 2, user_id: "u1", mode: "drill", weakness_key: "rookEndgame" },
        { id: 3, user_id: "u1", mode: "rush", weakness_key: null },
      ],
      puzzle_attempts: [
        attempt(1, {}),
        attempt(2, { correct: false }),
        attempt(3, { solve_ms: 40_000 }), // correct but slow: not solved
        attempt(4, { attempted_at: ago(8) }), // too long ago
        attempt(5, { session_id: 2 }),
        attempt(6, { session_id: 3, mode: "rush" }), // Rush doesn't count
        attempt(7, { user_id: "u2" }), // someone else's
      ],
    });
    expect(await recentDrills(db, "u1", NOW)).toEqual({
      "fork:missed": { attempted: 3, solved: 1 },
      rookEndgame: { attempted: 1, solved: 1 },
    });
  });

  it("returns nothing without recent drills", async () => {
    const { db } = fakeDb({ training_sessions: [], puzzle_attempts: [] });
    expect(await recentDrills(db, "u1", NOW)).toEqual({});
  });
});
