import { describe, expect, it } from "vitest";
import { formatScore, parseInfo, pvToSan, whiteShare } from "../src/lib/training/engine";

describe("parseInfo", () => {
  it("reads depth, line number, score and moves, turning the score to White's view", () => {
    const line = "info depth 18 seldepth 24 multipv 2 score cp -35 nodes 123 nps 9 pv e7e5 g1f3 b8c6";
    expect(parseInfo(line, true)).toEqual({ depth: 18, multipv: 2, score: { cp: -35 }, pv: ["e7e5", "g1f3", "b8c6"] });
    expect(parseInfo(line, false)).toEqual({ depth: 18, multipv: 2, score: { cp: 35 }, pv: ["e7e5", "g1f3", "b8c6"] });
  });

  it("reads mate scores, and assumes line 1 when multipv is missing", () => {
    expect(parseInfo("info depth 5 score mate 2 pv d1d8 g8h7 d8h8", false)).toEqual({
      depth: 5, multipv: 1, score: { mate: -2 }, pv: ["d1d8", "g8h7", "d8h8"],
    });
  });

  it("ignores everything that isn't a finished line", () => {
    expect(parseInfo("info depth 10 currmove e2e4 currmovenumber 1", true)).toBeNull();
    expect(parseInfo("info depth 10 score cp 20 lowerbound pv e2e4", true)).toBeNull();
    expect(parseInfo("bestmove e2e4 ponder e7e5", true)).toBeNull();
    expect(parseInfo("info string NNUE evaluation using nn.bin", true)).toBeNull();
  });
});

describe("presenting the evaluation", () => {
  it("fills the bar for White from the score", () => {
    expect(whiteShare({ cp: 0 })).toBe(50);
    expect(whiteShare({ cp: 300 })).toBeGreaterThan(70);
    expect(whiteShare({ cp: -300 })).toBeLessThan(30);
    expect(whiteShare({ mate: 3 })).toBe(100);
    expect(whiteShare({ mate: -1 })).toBe(0);
  });

  it("formats scores the usual way", () => {
    expect(formatScore({ cp: 134 })).toBe("+1.3");
    expect(formatScore({ cp: -40 })).toBe("−0.4");
    expect(formatScore({ cp: 0 })).toBe("0.0");
    expect(formatScore({ mate: 3 })).toBe("M3");
    expect(formatScore({ mate: -2 })).toBe("−M2");
  });

  it("writes engine lines in normal notation with move numbers", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(pvToSan(start, ["e2e4", "e7e5", "g1f3"])).toBe("1. e4 e5 2. Nf3");
    const blackToMove = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    expect(pvToSan(blackToMove, ["e7e5", "g1f3", "b8c6"])).toBe("1… e5 2. Nf3 Nc6");
    expect(pvToSan(start, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"], 3)).toBe("1. e4 e5 2. Nf3");
    expect(pvToSan(start, ["e2e4", "zzzz"])).toBe("1. e4");
  });
});
