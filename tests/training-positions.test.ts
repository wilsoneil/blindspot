import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { recordPuzzleAttempt } from "../src/lib/training/attempts";
import { loadDueReviews } from "../src/lib/training/run";
import { FindMoveRun } from "../src/lib/training/play";
import { selectPositions } from "../src/lib/training/positions";
import { currentRating, START } from "../src/lib/training/rating";
import { selectFor, weaknessFromKey } from "../src/lib/training/sources";
import { fakeDb } from "./fake-db";

// Made-up position: White to move, Nc7+ forks king and rook (the only good move).
const FORK = "r3k3/7p/7p/3N4/8/8/8/6K1 w - - 0 2";

/** A made-up stored mistake, as the analysis job saves it. */
function mistake(id: number, o: Record<string, unknown> = {}) {
  return {
    id, user_id: "u1", fen: FORK, labels: ["fork:missed", "phaseTransition"], accepted_moves: ["d5c7"], subtlety: 1,
    played_san: "Kh2", best_san: "Nc7+", played_at: "2026-10-01T12:00:00Z", ...o,
  };
}

describe("FindMoveRun", () => {
  it("is solved by any accepted move, in one move, with no setup move", () => {
    const run = new FindMoveRun(FORK, ["d5c7", "d5f6"]);
    expect(run.userColor).toBe("white");
    expect(run.userMoves).toBe(1);
    expect(run.setupMove).toBeNull();
    expect(run.play("d5f6")).toEqual({ result: "solved" });
    expect(run.solved).toBe(true);
  });

  it("takes back a move that isn't accepted, and ignores illegal ones", () => {
    const run = new FindMoveRun(FORK, ["d5c7"]);
    const before = run.fen;
    expect(run.play("g1h2")).toEqual({ result: "wrong" });
    expect(run.fen).toBe(before);
    expect(run.play("d5d8")).toEqual({ result: "illegal" });
    expect(run.expectedMove()).toBe("d5c7");
  });

  it("refuses a position without accepted moves", () => {
    expect(() => new FindMoveRun(FORK, [])).toThrow("no accepted moves");
  });
});

describe("weaknessFromKey", () => {
  it("sends positional labels, alone or in pairs, to the user's own positions", () => {
    expect(weaknessFromKey("pawnDecisions+phaseTransition")).toEqual({
      key: "pawnDecisions+phaseTransition", kind: "ownGames", labelKeys: ["pawnDecisions", "phaseTransition"],
    });
    expect(weaknessFromKey("fork:missed")).toEqual({ key: "fork:missed", kind: "puzzles", puzzleLabels: ["fork"] });
    expect(weaknessFromKey("opening:white:Italian Game")).toBeNull();
  });
});

describe("selectPositions", () => {
  it("serves the user's own untrained positions with all the labels, as one-move items", async () => {
    const { db } = fakeDb({
      mistakes: [
        mistake(1), mistake(2), mistake(3, { labels: ["fork:missed"] }), // 3 lacks phaseTransition
        mistake(4, { accepted_moves: null }), // not worked out yet
        mistake(5, { user_id: "u2" }), // someone else's
        mistake(6),
      ],
      puzzle_attempts: [{ id: 1, user_id: "u1", mistake_id: 2, puzzle_id: null }],
    });
    const got = await selectPositions(db, { userId: "u1", labelKeys: ["phaseTransition"], count: 10, level: 1500, exclude: ["m6"] });
    expect(got.map((p) => p.id)).toEqual(["m1"]);
    expect(got[0]).toMatchObject({
      fen: FORK, moves: [], rating: 1900, // subtlety 1: 400 above the level
      position: { mistakeId: 1, accepted: ["d5c7"], playedSan: "Kh2", bestSan: "Nc7+" },
    });
  });

  it("prefers positions near a rating when asked (the mixed modes' ladder)", async () => {
    const { db } = fakeDb({
      mistakes: [mistake(1, { subtlety: 0 }), mistake(2, { subtlety: 0.5 }), mistake(3, { subtlety: 1 })],
      puzzle_attempts: [],
    });
    const got = await selectPositions(db, { userId: "u1", labelKeys: ["fork:missed"], count: 2, level: 1500, near: 1150 });
    expect(got.map((p) => p.id)).toEqual(["m1", "m2"]);
  });

  it("returns nothing (rather than failing) before the accepted moves exist", async () => {
    const { db } = fakeDb({ mistakes: [], puzzle_attempts: [] }, { failOn: "mistakes" });
    // The fake's error message doesn't mention the column, so this is a real failure.
    await expect(selectPositions(db, { userId: "u1", labelKeys: ["fork:missed"], count: 2, level: 1500 })).rejects.toThrow();
  });
});

describe("attempts at the user's own positions", () => {
  function setup() {
    const tables = { mistakes: [mistake(1), mistake(2, { user_id: "u2" })], puzzles: [], training_sessions: [], puzzle_attempts: [], review_queue: [] };
    return { tables, db: fakeDb(tables).db };
  }
  const input = { mistakeId: 1, sessionId: null, mode: "drill" as const, profileKey: "300", solved: true, solveMs: 5000, wrongMoves: 0, revealed: false };

  it("are saved against the mistake, with no puzzle rating, and never move the Blindspot rating", async () => {
    const { db, tables } = setup();
    const out = await recordPuzzleAttempt(db, "u1", DEFAULT_SETTINGS, input, 1500);
    expect(out).toMatchObject({ firstAttempt: true, fullySolved: true, targetMs: 15_000 });
    expect(tables.puzzle_attempts[0]).toMatchObject({ mistake_id: 1, puzzle_rating: null, labels: ["fork:missed", "phaseTransition"] });
    expect(tables.puzzle_attempts[0]).not.toHaveProperty("puzzle_id");
    expect(await currentRating(db, "u1")).toEqual(START);
  });

  it("can't use someone else's position", async () => {
    const { db } = setup();
    await expect(recordPuzzleAttempt(db, "u1", DEFAULT_SETTINGS, { ...input, mistakeId: 2 }, 1500)).rejects.toThrow("isn't one of yours");
  });

  it("put a missed position on the review queue, and it comes back when due", async () => {
    const { db, tables } = setup();
    await recordPuzzleAttempt(db, "u1", DEFAULT_SETTINGS, { ...input, wrongMoves: 1 }, 1500);
    expect(tables.review_queue[0]).toMatchObject({ user_id: "u1", mistake_id: 1, step: 0 });
    expect(await loadDueReviews(db, "u1", { limit: 4, level: 1500 })).toEqual([]); // not due yet
    const tomorrow = new Date(Date.now() + 2 * 86_400_000);
    const got = await loadDueReviews(db, "u1", { limit: 4, level: 1500, now: tomorrow });
    expect(got.map((p) => [p.id, p.review])).toEqual([["m1", true]]);
  });
});

describe("allowed weaknesses: own positions and Lichess puzzles, one of each in turn", () => {
  const puzzle = (id: string) => ({
    id, fen: "8/8/8/8/8/8/8/8 w - - 0 1", moves: "a2a3 a7a6", rating: 1500, themes: [], labels: ["fork", "defending"],
  });
  const own = (id: number) => mistake(id, { labels: ["fork:allowed", "defending", "phaseMiddlegame"] });

  it("gets both, from the weakness's own labels", () => {
    expect(weaknessFromKey("defending+fork:allowed")).toEqual({
      key: "defending+fork:allowed", kind: "puzzles", puzzleLabels: ["defending", "fork"], ownLabelKeys: ["defending", "fork:allowed"],
    });
    expect(weaknessFromKey("fork:missed")).not.toHaveProperty("ownLabelKeys");
  });

  it("alternates own position, puzzle, own position, ...", async () => {
    const { db } = fakeDb({
      mistakes: [own(1), own(2), own(3), mistake(4, { labels: ["fork:missed", "defending"] })],
      puzzles: Array.from({ length: 10 }, (_, i) => puzzle(`p${i}`)),
      puzzle_attempts: [],
    });
    const got = await selectFor(db, weaknessFromKey("defending+fork:allowed")!, { userId: "u1", count: 5, level: 1500 });
    expect(got.map((p) => (p.position ? "own" : "puzzle"))).toEqual(["own", "puzzle", "own", "puzzle", "own"]);
    expect(got.filter((p) => p.position).map((p) => p.id).sort()).toEqual(["m1", "m2", "m3"]); // not m4: it was missed, not allowed
  });

  it("carries on with puzzles alone once the own positions are used up", async () => {
    const { db } = fakeDb({
      mistakes: [own(1)],
      puzzles: Array.from({ length: 10 }, (_, i) => puzzle(`p${i}`)),
      puzzle_attempts: [{ id: 1, user_id: "u1", mistake_id: 1, puzzle_id: null }],
    });
    const got = await selectFor(db, weaknessFromKey("defending+fork:allowed")!, { userId: "u1", count: 4, level: 1500 });
    expect(got).toHaveLength(4);
    expect(got.every((p) => !p.position)).toBe(true);
  });

  it("also mixes in own positions for a pair with a label from the user's own games", () => {
    expect(weaknessFromKey("defending+longMate:missed")).toMatchObject({ ownLabelKeys: ["defending", "longMate:missed"] });
    expect(weaknessFromKey("defending")).not.toHaveProperty("ownLabelKeys"); // a single label: unchanged
    expect(weaknessFromKey("fork:missed+rookEndgame")).not.toHaveProperty("ownLabelKeys");
  });

  it("fills up with own positions when the puzzles run short", async () => {
    const { db } = fakeDb({
      mistakes: [1, 2, 3, 4, 5].map((id) => mistake(id, { labels: ["longMate:allowed", "defending"] })),
      puzzles: [puzzle("p1")].map((p) => ({ ...p, labels: ["longMate", "defending"] })),
      puzzle_attempts: [],
    });
    const got = await selectFor(db, weaknessFromKey("defending+longMate:allowed")!, { userId: "u1", count: 5, level: 1500 });
    expect(got).toHaveLength(5);
    expect(got.filter((p) => !p.position).map((p) => p.id)).toEqual(["p1"]);
    expect(new Set(got.map((p) => p.id)).size).toBe(5); // no position twice
  });
});
