import { describe, expect, it } from "vitest";
import { AttemptError, recordPuzzleAttempt, type AttemptInput } from "../src/lib/training/attempts";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { fakeDb } from "./fake-db";

const USER = "user-1";
const OTHER = "user-2";

function setup(extra: { sessions?: Record<string, unknown>[]; attempts?: Record<string, unknown>[] } = {}) {
  const tables = {
    // A made-up two-move puzzle rated 1500, and a one-move one rated 1800.
    puzzles: [
      { id: "aaaaa", moves: "e2e4 e7e5 g1f3 b8c6", rating: 1500, labels: ["fork", "phaseOpening"] },
      { id: "bbbbb", moves: "e2e4 d8h4", rating: 1800, labels: ["shortMate"] },
    ],
    training_sessions: extra.sessions ?? [],
    puzzle_attempts: extra.attempts ?? [],
  };
  const { db } = fakeDb(tables, {
    unique: {
      puzzle_attempts: [{ columns: ["user_id", "puzzle_id"], where: (r) => r.first_attempt === true }],
    },
  });
  return { db, tables };
}

const input = (o: Partial<AttemptInput> = {}): AttemptInput => ({
  puzzleId: "aaaaa", sessionId: null, mode: "drill", profileKey: "300", weaknessKey: "fork:missed",
  solved: true, solveMs: 12_000, wrongMoves: 0, revealed: false, ...o,
});

describe("recordPuzzleAttempt", () => {
  it("starts a session and saves a first attempt with the puzzle's rating and target time", async () => {
    const { db, tables } = setup();
    const out = await recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input(), 1500);
    expect(out).toMatchObject({ firstAttempt: true, correct: true, fullySolved: true, targetMs: 30_000, session: { attempted: 1, solved: 1 } });
    expect(tables.training_sessions).toHaveLength(1);
    expect(tables.training_sessions[0]).toMatchObject({ user_id: USER, mode: "drill", profile_key: "300", weakness_key: "fork:missed" });
    expect(tables.puzzle_attempts[0]).toMatchObject({
      user_id: USER, session_id: out.sessionId, puzzle_id: "aaaaa", puzzle_rating: 1500, labels: ["fork", "phaseOpening"],
      first_attempt: true, correct: true, solve_ms: 12_000, target_ms: 30_000, retries: 0, revealed: false,
    });
  });

  it("marks a later attempt at the same puzzle as a repeat, and keeps adding to the same session", async () => {
    const { db, tables } = setup();
    const first = await recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input(), 1500);
    const again = await recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input({ sessionId: first.sessionId }), 1500);
    expect(again.firstAttempt).toBe(false);
    expect(again.sessionId).toBe(first.sessionId);
    expect(again.session).toEqual({ attempted: 2, solved: 2 });
    expect(tables.puzzle_attempts.map((a) => a.first_attempt)).toEqual([true, false]);
  });

  it("doesn't count another user's attempt, or let another user's session be used", async () => {
    const { db, tables } = setup({
      sessions: [{ id: 77, user_id: OTHER, attempted: 0, solved: 0 }],
      attempts: [{ id: 1, user_id: OTHER, puzzle_id: "aaaaa", first_attempt: true }],
    });
    const out = await recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input({ sessionId: 77 }), 1500);
    expect(out.firstAttempt).toBe(true);
    expect(out.sessionId).not.toBe(77);
    expect(tables.training_sessions.find((s) => s.id === 77)).toMatchObject({ attempted: 0 });
  });

  it("falls back to a repeat if a first attempt was saved at the same moment", async () => {
    const { db, tables } = setup();
    // A first attempt exists, but the earlier-attempts check misses it (as in a race between two tabs).
    tables.puzzle_attempts.push({ id: 5, user_id: USER, puzzle_id: "aaaaa", first_attempt: true });
    const hidden = tables.puzzle_attempts;
    const realFrom = db.from.bind(db);
    let first = true;
    (db as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === "puzzle_attempts" && first) {
        first = false;
        tables.puzzle_attempts = [];
        const q = realFrom(t);
        tables.puzzle_attempts = hidden;
        return q;
      }
      return realFrom(t);
    };
    const out = await recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input(), 1500);
    expect(out.firstAttempt).toBe(false);
  });

  it("counts wrong moves, reveals and slow solves as not fully solved", async () => {
    const { db } = setup();
    const wrong = await recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input({ wrongMoves: 2 }), 1500);
    expect(wrong).toMatchObject({ correct: false, fullySolved: false });
    const revealed = await recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input({ puzzleId: "bbbbb", revealed: true, solved: false }), 1500);
    expect(revealed).toMatchObject({ correct: false, fullySolved: false });
    const slow = await recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input({ solveMs: 31_000 }), 1500);
    expect(slow).toMatchObject({ correct: true, fullySolved: false });
  });

  it("gives puzzles well above the user's level more time, and follows the target-time setting", async () => {
    const { db } = setup();
    const hard = await recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input({ puzzleId: "bbbbb" }), 1500);
    expect(hard.targetMs).toBe(22_500); // one move, 1800 vs 1500: 15 s × 1.5
    const strict = await recordPuzzleAttempt(db, USER, { ...DEFAULT_SETTINGS, targetTime: "stricter" }, input(), 1500);
    expect(strict.targetMs).toBe(22_500); // two moves: 30 s × 0.75
  });

  it("keeps stored times within sensible bounds", async () => {
    const { db, tables } = setup();
    await recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input({ solveMs: -50 }), 1500);
    await recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input({ solveMs: 9e9 }), 1500);
    expect(tables.puzzle_attempts.map((a) => a.solve_ms)).toEqual([0, 3_600_000]);
  });

  it("refuses unknown puzzles, modes and bad numbers", async () => {
    const { db } = setup();
    await expect(recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input({ puzzleId: "zzzzz" }), 1500)).rejects.toThrow(AttemptError);
    await expect(recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input({ mode: "random" as never }), 1500)).rejects.toThrow("Unknown training mode");
    await expect(recordPuzzleAttempt(db, USER, DEFAULT_SETTINGS, input({ solveMs: NaN }), 1500)).rejects.toThrow("Bad attempt data");
  });
});
