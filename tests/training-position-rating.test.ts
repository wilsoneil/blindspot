import { describe, expect, it } from "vitest";
import {
  expectedSolved, fitCalibration, loadTrainingHistory, MIN_CALIBRATION_ATTEMPTS, MIN_PUZZLES_BEFORE, positionRating,
  trainingLevel, type PositionAttempt,
} from "../src/lib/training/position-rating";
import { expectedScore, replay } from "../src/lib/training/rating";
import { fakeDb } from "./fake-db";

/** A seeded random number generator, so the simulated attempts are the same every run. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

/** Made-up attempts whose real difficulty is a + b × subtlety. */
function simulate(n: number, a: number, b: number, seed = 1): PositionAttempt[] {
  const random = seeded(seed);
  return Array.from({ length: n }, () => {
    const subtlety = random();
    const rating = 1700 + 200 * random();
    return { subtlety, rating, fullySolved: random() < expectedScore(rating, a + b * subtlety) };
  });
}

describe("positionRating", () => {
  it("uses the fixed rule (level ± 400) until there is a fitted one", () => {
    expect(positionRating(1800, 0, null)).toBe(1400);
    expect(positionRating(1800, 1, null)).toBe(2200);
    expect(positionRating(1800, null, null)).toBe(1800);
  });

  it("uses the fitted rule, whatever the level", () => {
    const cal = { a: 1500, b: 600, attempts: 200 };
    expect(positionRating(1800, 0.5, cal)).toBe(1800);
    expect(positionRating(1200, 0.5, cal)).toBe(1800);
  });
});

describe("fitCalibration", () => {
  it("waits for enough attempts", () => {
    expect(fitCalibration(simulate(MIN_CALIBRATION_ATTEMPTS - 1, 1500, 600))).toBeNull();
    expect(fitCalibration(simulate(MIN_CALIBRATION_ATTEMPTS, 1500, 600))).not.toBeNull();
  });

  it("recovers the real difficulty from enough attempts", () => {
    const cal = fitCalibration(simulate(3000, 1500, 600))!;
    expect(cal.attempts).toBe(3000);
    // Compare ratings across the range rather than a and b, which trade off against each other.
    for (const s of [0, 0.5, 1]) expect(Math.abs(positionRating(0, s, cal) - (1500 + 600 * s))).toBeLessThan(80);
  });

  it("finds positions easier than the fixed rule when they are mostly solved", () => {
    const attempts = simulate(300, 1300, 400, 7);
    const cal = fitCalibration(attempts)!;
    const fixed = 1800;
    expect(positionRating(fixed, 0.5, cal)).toBeLessThan(positionRating(fixed, 0.5, null));
    // The fit should match the real solve rate better than the fixed rule.
    const real = attempts.filter((x) => x.fullySolved).length / attempts.length;
    expect(Math.abs(expectedSolved(attempts, cal) - real)).toBeLessThan(0.03);
  });

  it("stays sensible when every position was solved", () => {
    const all = simulate(150, 1500, 600).map((x) => ({ ...x, fullySolved: true }));
    const cal = fitCalibration(all)!;
    expect(Number.isFinite(cal.a)).toBe(true);
    expect(cal.b).toBeGreaterThanOrEqual(0);
    expect(cal.b).toBeLessThanOrEqual(1600);
    // Easier than the fixed rule, but not absurdly so.
    expect(positionRating(0, 0.5, cal)).toBeGreaterThan(800);
  });
});

describe("loadTrainingHistory", () => {
  const puzzle = (id: number, o: Record<string, unknown> = {}) => ({
    id, user_id: "u1", puzzle_id: `p${id}`, mistake_id: null, mistakes: null, first_attempt: true,
    puzzle_rating: 1600, correct: true, solve_ms: 10_000, target_ms: 30_000, ...o,
  });
  const own = (id: number, subtlety: number, o: Record<string, unknown> = {}) => ({
    id, user_id: "u1", puzzle_id: null, mistake_id: id, mistakes: { subtlety }, first_attempt: true,
    puzzle_rating: null, correct: false, solve_ms: 10_000, target_ms: 30_000, ...o,
  });

  it("pairs each own-position attempt with the rating just before it, after the rating has settled", async () => {
    const early = Array.from({ length: MIN_PUZZLES_BEFORE }, (_, i) => puzzle(i + 1));
    const { db } = fakeDb({
      puzzle_attempts: [
        own(100, 0.2), // before the rating settled: left out
        ...early.map((p) => ({ ...p, id: p.id + 100 })),
        own(200, 0.4),
        puzzle(201, { correct: false }),
        own(202, 0.9, { correct: true }),
        own(203, 0.5, { first_attempt: false }), // a repeat: ignored
      ],
    });
    const { rating, positions } = await loadTrainingHistory(db, "u1");
    const ratings = replay([...early.map(() => ({ puzzleRating: 1600, fullySolved: true })), { puzzleRating: 1600, fullySolved: false }]);
    expect(rating).toEqual(ratings.at(-1));
    expect(positions).toEqual([
      { subtlety: 0.4, rating: ratings[MIN_PUZZLES_BEFORE - 1].rating, fullySolved: false },
      { subtlety: 0.9, rating: ratings[MIN_PUZZLES_BEFORE].rating, fullySolved: true },
    ]);
  });

  it("gives the level and no fitted rule while attempts are few", async () => {
    const { db } = fakeDb({ puzzle_attempts: [puzzle(1)] });
    const t = await trainingLevel(db, "u1");
    expect(t.calibration).toBeNull();
    expect(t.level).toBe(Math.round(replay([{ puzzleRating: 1600, fullySolved: true }])[0].rating));
  });
});
