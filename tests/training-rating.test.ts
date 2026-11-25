import { describe, expect, it } from "vitest";
import { currentRating, glicko2, MIN_RD, replay, START } from "../src/lib/training/rating";
import { fakeDb } from "./fake-db";

describe("glicko2", () => {
  it("matches Glickman's worked example", () => {
    // "Example of the Glicko-2 system" (Glickman, 2013): a 1500 / 200 / 0.06 player beats a
    // 1400 / 30 player and loses to 1550 / 100 and 1700 / 300, with tau = 0.5.
    const after = glicko2({ rating: 1500, rd: 200, vol: 0.06 }, [
      { rating: 1400, rd: 30, score: 1 },
      { rating: 1550, rd: 100, score: 0 },
      { rating: 1700, rd: 300, score: 0 },
    ], 0.5);
    expect(after.rating).toBeCloseTo(1464.06, 1);
    expect(after.rd).toBeCloseTo(151.52, 1);
    expect(after.vol).toBeCloseTo(0.05999, 4);
  });

  it("only widens RD when there are no games", () => {
    const after = glicko2({ rating: 1600, rd: 100, vol: 0.06 }, []);
    expect(after.rating).toBe(1600);
    expect(after.rd).toBeGreaterThan(100);
  });
});

describe("replay", () => {
  it("starts at 1500 and moves fast at first, then settles", () => {
    const wins = replay(Array.from({ length: 40 }, () => ({ puzzleRating: 1500, fullySolved: true })));
    expect(wins[0].rating).toBeGreaterThan(1600); // a big first step while RD is 350
    expect(wins[39].rating).toBeGreaterThan(wins[38].rating);
    expect(wins[39].rating - wins[38].rating).toBeLessThan(wins[1].rating - wins[0].rating);
    expect(wins[39].rd).toBeLessThan(START.rd);
  });

  it("only rises for puzzles solved correctly within the target time", () => {
    const [afterLoss] = replay([{ puzzleRating: 900, fullySolved: false }]);
    expect(afterLoss.rating).toBeLessThan(1500);
    const mixed = replay([
      { puzzleRating: 1500, fullySolved: true },
      { puzzleRating: 1200, fullySolved: false },
      { puzzleRating: 2000, fullySolved: false },
    ]);
    expect(mixed[1].rating).toBeLessThan(mixed[0].rating);
    expect(mixed[2].rating).toBeLessThanOrEqual(mixed[1].rating);
  });

  it("finds a level between what the user solves and what they don't", () => {
    // Solves every 1300 puzzle, fails every 1700 one.
    const attempts = Array.from({ length: 200 }, (_, i) => (i % 2 ? { puzzleRating: 1300, fullySolved: true } : { puzzleRating: 1700, fullySolved: false }));
    const last = replay(attempts).at(-1)!;
    expect(last.rating).toBeGreaterThan(1350);
    expect(last.rating).toBeLessThan(1650);
    expect(last.rd).toBeGreaterThanOrEqual(MIN_RD);
  });
});

describe("currentRating", () => {
  it("replays only the user's first attempts at Lichess puzzles, in order", async () => {
    const attempt = (id: number, o: Record<string, unknown>) => ({
      id, user_id: "u1", puzzle_id: `p${id}`, first_attempt: true, puzzle_rating: 1500, correct: true, solve_ms: 10_000, target_ms: 30_000, ...o,
    });
    const { db } = fakeDb({
      puzzle_attempts: [
        attempt(1, {}),
        attempt(2, { first_attempt: false }), // a repeat: ignored
        attempt(3, { user_id: "u2", correct: false }), // someone else: ignored
        attempt(4, { puzzle_id: null, puzzle_rating: null }), // an own-game position: ignored
        attempt(5, { solve_ms: 40_000 }), // correct but slow: a loss
      ],
    });
    const expected = replay([{ puzzleRating: 1500, fullySolved: true }, { puzzleRating: 1500, fullySolved: false }]).at(-1);
    expect(await currentRating(db, "u1")).toEqual(expected);
    expect(await currentRating(db, "nobody")).toEqual(START);
  });
});
