import { describe, expect, it } from "vitest";
import { MIN_ATTEMPTS, puzzleScores, type PuzzleAttemptForScore } from "../src/lib/analysis/puzzle-scores";

const NOW = new Date("2026-11-25T12:00:00Z");
const opts = { halfLifeDays: 60, now: NOW };

/** Made-up attempts: n puzzles rated 1500 with these labels, solved or not. */
function attempts(n: number, labels: string[], solved: (i: number) => boolean, daysAgo = 1): PuzzleAttemptForScore[] {
  const at = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  return Array.from({ length: n }, (_, i) => ({ labels, puzzleRating: 1500, fullySolved: solved(i), attemptedAt: at }));
}

/** Interleaves lists, so neither label is played first (the rating moves as attempts go on). */
function mix(...lists: PuzzleAttemptForScore[][]): PuzzleAttemptForScore[] {
  const out: PuzzleAttemptForScore[] = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

describe("puzzleScores", () => {
  it("scores a label the user fails more often as weaker than the family average, on both tactic sides", () => {
    const scores = puzzleScores(mix(
      attempts(20, ["fork"], (i) => i % 4 === 0), // solves a quarter
      attempts(20, ["pin"], (i) => i % 4 !== 0), // solves three quarters
    ), opts);
    expect(scores.get("fork:missed")).toBeGreaterThan(1);
    expect(scores.get("fork:allowed")).toBe(scores.get("fork:missed"));
    expect(scores.get("pin:missed")).toBeLessThan(1);
  });

  it("scores labels of the same performance at 1", () => {
    const scores = puzzleScores(mix(
      attempts(20, ["rookEndgame"], (i) => i % 2 === 0),
      attempts(20, ["pawnEndgame"], (i) => i % 2 === 0),
    ), opts);
    expect(scores.get("rookEndgame")).toBeCloseTo(1, 1);
    expect(scores.get("pawnEndgame")).toBeCloseTo(1, 1);
  });

  it("compares each label only with its own family", () => {
    // Endgames are failed far more than tactics, but each family has one label: both score 1.
    const scores = puzzleScores(mix(
      attempts(20, ["fork"], () => true).map((a, i) => ({ ...a, fullySolved: i % 5 !== 0 })),
      attempts(20, ["rookEndgame"], (i) => i % 5 === 0),
    ), opts);
    expect(scores.get("fork:missed")).toBeCloseTo(1, 5);
    expect(scores.get("rookEndgame")).toBeCloseTo(1, 5);
  });

  it("leaves out labels with too few attempts, and pulls small samples towards 1", () => {
    const few = puzzleScores(mix(
      attempts(MIN_ATTEMPTS - 1, ["skewer"], () => false),
      attempts(30, ["fork"], (i) => i % 2 === 0),
    ), opts);
    expect(few.has("skewer:missed")).toBe(false);

    // A large, steady label keeps the family's average about the same in both cases.
    const steady = () => attempts(400, ["pin"], (i) => i % 2 === 0);
    const small = puzzleScores(mix(attempts(5, ["skewer"], () => false), steady()), opts);
    const large = puzzleScores(mix(attempts(30, ["skewer"], () => false), steady()), opts);
    expect(small.get("skewer:missed")!).toBeGreaterThan(1);
    expect(small.get("skewer:missed")!).toBeLessThan(large.get("skewer:missed")!);
  });

  it("weights recent attempts more", () => {
    const old = attempts(20, ["fork"], () => false, 300); // failed long ago
    const recent = attempts(20, ["fork"], () => true, 1); // solved lately
    const pin = attempts(40, ["pin"], (i) => i % 2 === 0, 1);
    const scores = puzzleScores([...old, ...mix(recent, pin.slice(0, 20)), ...pin.slice(20)], opts);
    expect(scores.get("fork:missed")).toBeLessThan(1);
  });

  it("returns nothing without attempts, or when nothing was ever missed", () => {
    expect(puzzleScores([], opts).size).toBe(0);
    expect(puzzleScores(attempts(10, ["fork"], () => true), opts).size).toBe(0);
  });

  it("ignores labels it doesn't know", () => {
    const scores = puzzleScores(attempts(10, ["fork", "notALabel"], (i) => i % 2 === 0), opts);
    expect([...scores.keys()].sort()).toEqual(["fork:allowed", "fork:missed"]);
  });
});
