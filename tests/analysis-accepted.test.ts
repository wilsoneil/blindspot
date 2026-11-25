import { describe, expect, it } from "vitest";
import { acceptedMoves, approxRating, parseMultiPv } from "../src/lib/analysis/accepted";

describe("parseMultiPv", () => {
  it("reads the line number, depth, first move and score", () => {
    expect(parseMultiPv("info depth 20 seldepth 28 multipv 3 score cp -45 nodes 1 pv g1f3 b8c6 f1b5")).toEqual({
      multipv: 3, depth: 20, move: { move: "g1f3", score: { cp: -45 } },
    });
    expect(parseMultiPv("info depth 9 score mate 2 pv d1d8 g8h7")).toEqual({
      multipv: 1, depth: 9, move: { move: "d1d8", score: { mate: 2 } },
    });
  });

  it("ignores bounds and lines without a move", () => {
    expect(parseMultiPv("info depth 20 multipv 1 score cp 30 lowerbound pv e2e4")).toBeNull();
    expect(parseMultiPv("info depth 20 currmove e2e4 currmovenumber 1")).toBeNull();
    expect(parseMultiPv("bestmove e2e4")).toBeNull();
  });
});

describe("acceptedMoves", () => {
  it("accepts the only good move and rates the position as subtle when the rest lose badly", () => {
    const r = acceptedMoves([
      { move: "d1d8", score: { mate: 1 } },
      { move: "g2g3", score: { cp: -150 } },
      { move: "h2h3", score: { cp: -160 } },
    ]);
    expect(r.accepted).toEqual(["d1d8"]);
    expect(r.subtlety).toBe(1);
  });

  it("accepts every move within the margin of the best", () => {
    const r = acceptedMoves([
      { move: "e2e4", score: { cp: 40 } },
      { move: "d2d4", score: { cp: 35 } },
      { move: "g1f3", score: { cp: 30 } },
      { move: "a2a4", score: { cp: -100 } },
    ]);
    expect(r.accepted).toEqual(["e2e4", "d2d4", "g1f3"]);
    expect(r.subtlety).toBeGreaterThan(0);
    expect(r.subtlety).toBeLessThan(0.5);
  });

  it("counts a position as easy when everything listed is fine, or little is at stake", () => {
    expect(acceptedMoves([{ move: "e2e4", score: { cp: 10 } }, { move: "d2d4", score: { cp: 5 } }]).subtlety).toBe(0);
    // Totally winning either way: a "worse" move barely changes the winning chance.
    const won = acceptedMoves([{ move: "a1a8", score: { cp: 1500 } }, { move: "b1b8", score: { cp: 1100 } }]);
    expect(won.accepted).toEqual(["a1a8", "b1b8"]);
  });

  it("gives more subtlety to one good move than to two", () => {
    const one = acceptedMoves([{ move: "a", score: { cp: 100 } }, { move: "b", score: { cp: -100 } }]);
    const two = acceptedMoves([{ move: "a", score: { cp: 100 } }, { move: "c", score: { cp: 95 } }, { move: "b", score: { cp: -100 } }]);
    expect(one.subtlety).toBeGreaterThan(two.subtlety);
  });

  it("handles no moves (a finished game)", () => {
    expect(acceptedMoves([])).toEqual({ accepted: [], subtlety: 0 });
  });
});

describe("approxRating", () => {
  it("spreads positions from 400 below to 400 above the user's level", () => {
    expect(approxRating(1500, 0)).toBe(1100);
    expect(approxRating(1500, 0.5)).toBe(1500);
    expect(approxRating(1500, 1)).toBe(1900);
  });
});
