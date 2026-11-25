import { describe, expect, it } from "vitest";
import { PuzzleRun, targetTimeMs } from "../src/lib/training/play";

// Made-up positions, not from any real game.
// Back-rank mate: Black's rook leaves the back rank, White mates on d8.
const BACK_RANK = "2r3k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1";
// Two white rooks: after ...b6 (which shuts the b-file), both Rd8 and Ra8 mate.
const TWO_ROOKS = "6k1/1p3ppp/8/8/8/8/1r3PPP/R2R2K1 b - - 0 1";
// Knight fork: Nc7+ forks king and rook, then Nxa8 (not mate).
const FORK = "r3k3/7p/8/3N4/8/8/8/6K1 b - - 0 1";
// Promotion: the pawn must become a queen.
const PROMOTE = "8/P7/7k/8/8/8/8/K7 b - - 0 1";

describe("PuzzleRun", () => {
  it("plays the opponent's setup move, then it's the user's turn", () => {
    const run = new PuzzleRun(BACK_RANK, ["c8c2", "d1d8"]);
    expect(run.setupMove).toBe("c8c2");
    expect(run.userColor).toBe("white");
    expect(run.userMoves).toBe(1);
    expect(run.fen.split(" ")[1]).toBe("w");
    expect(run.expectedMove()).toBe("d1d8");
  });

  it("solves a one-move puzzle with the stored move", () => {
    const run = new PuzzleRun(BACK_RANK, ["c8c2", "d1d8"]);
    expect(run.play("d1d8")).toEqual({ result: "solved" });
    expect(run.solved).toBe(true);
    expect(run.dests().size).toBe(0);
    expect(run.play("g1f1")).toEqual({ result: "illegal" }); // nothing more to play
  });

  it("accepts a different move that also gives checkmate", () => {
    expect(new PuzzleRun(TWO_ROOKS, ["b7b6", "d1d8"]).play("d1d8")).toEqual({ result: "solved" });
    expect(new PuzzleRun(TWO_ROOKS, ["b7b6", "d1d8"]).play("a1a8")).toEqual({ result: "solved" });
  });

  it("plays the opponent's reply after each correct move, until the last move", () => {
    const run = new PuzzleRun(FORK, ["h7h6", "d5c7", "e8e7", "c7a8"]);
    expect(run.userMoves).toBe(2);
    expect(run.play("d5c7")).toEqual({ result: "correct", reply: "e8e7" });
    expect(run.solved).toBe(false);
    expect(run.expectedMove()).toBe("c7a8");
    expect(run.play("c7a8")).toEqual({ result: "solved" });
  });

  it("rejects a wrong move (even a check) and leaves the position as it was", () => {
    const run = new PuzzleRun(FORK, ["h7h6", "d5c7", "e8e7", "c7a8"]);
    const before = run.fen;
    expect(run.play("d5f6")).toEqual({ result: "wrong" });
    expect(run.fen).toBe(before);
    expect(run.play("d5c7")).toEqual({ result: "correct", reply: "e8e7" }); // can still go on
  });

  it("reports an illegal move without changing anything", () => {
    const run = new PuzzleRun(FORK, ["h7h6", "d5c7", "e8e7", "c7a8"]);
    const before = run.fen;
    expect(run.play("d5d8")).toEqual({ result: "illegal" });
    expect(run.play("zz")).toEqual({ result: "illegal" });
    expect(run.fen).toBe(before);
  });

  it("needs the right promotion piece", () => {
    const run = new PuzzleRun(PROMOTE, ["h6h5", "a7a8q"]);
    expect(run.isPromotion("a7", "a8")).toBe(true);
    expect(run.isPromotion("a1", "a2")).toBe(false);
    expect(run.play("a7a8n")).toEqual({ result: "wrong" });
    expect(run.play("a7a8q")).toEqual({ result: "solved" });
  });

  it("lists legal destinations for the board", () => {
    const run = new PuzzleRun(FORK, ["h7h6", "d5c7", "e8e7", "c7a8"]);
    const dests = run.dests();
    expect(dests.get("d5")?.sort()).toEqual(["b4", "b6", "c3", "c7", "e3", "e7", "f4", "f6"]);
    expect(dests.get("g1")?.sort()).toEqual(["f1", "f2", "g2", "h1", "h2"]);
  });

  it("refuses a malformed puzzle", () => {
    expect(() => new PuzzleRun(BACK_RANK, ["c8c2"])).toThrow("needs a setup move");
    expect(() => new PuzzleRun(BACK_RANK, ["c8c2", "d1d8", "g8f8"])).toThrow("needs a setup move");
    expect(() => new PuzzleRun(BACK_RANK, ["a1a2", "d1d8"])).toThrow("setup move a1a2 is illegal");
  });
});

describe("targetTimeMs", () => {
  const base = { userMoves: 2, puzzleRating: 1500, level: 1500 };

  it("allows 15 seconds per move the user plays", () => {
    expect(targetTimeMs({ ...base, setting: "normal" })).toBe(30_000);
    expect(targetTimeMs({ ...base, userMoves: 1, setting: "normal" })).toBe(15_000);
  });

  it("allows 50% longer for puzzles 200 or more above the user's level", () => {
    expect(targetTimeMs({ ...base, puzzleRating: 1699, setting: "normal" })).toBe(30_000);
    expect(targetTimeMs({ ...base, puzzleRating: 1700, setting: "normal" })).toBe(45_000);
  });

  it("follows the stricter / looser setting", () => {
    expect(targetTimeMs({ ...base, setting: "stricter" })).toBe(22_500);
    expect(targetTimeMs({ ...base, setting: "looser" })).toBe(45_000);
    expect(targetTimeMs({ ...base, puzzleRating: 1800, setting: "looser" })).toBe(67_500);
  });
});
