import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { flip, MISTAKE_THRESHOLD, winProbability, centipawns, formatScore } from "../src/lib/analysis/eval";
import { analyseGame, type Evaluator, type TaggerInput } from "../src/lib/analysis/game";
import { parseInfo } from "../scripts/lib/stockfish";

// A made-up game (the well-known Blackburne Shilling trap), not a real player's game.
const PGN = `[Event "Made up"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1`;

function positions(pgn: string) {
  const c = new Chess();
  c.loadPgn(pgn);
  const h = c.history({ verbose: true });
  return { fens: [...h.map((m) => m.before), c.fen()], moves: h.map((m) => m.lan) };
}

/**
 * A pretend engine. `white[i]` is the score of position i from White's side (default +0.30);
 * `best[i]` is its best move (default: the move actually played, so nothing is a mistake).
 */
function fakeEngine(white: Record<number, number>, best: Record<number, string> = {}): Evaluator {
  const { fens, moves } = positions(PGN);
  return {
    async newGame() {},
    async evaluate(fen) {
      const i = fens.indexOf(fen);
      const cp = white[i] ?? 30;
      const pv = [best[i] ?? moves[i], "a7a6"].filter(Boolean) as string[];
      return { score: { cp: i % 2 === 0 ? cp : -cp }, pv };
    },
  };
}

function fakeTagger(themes: (input: TaggerInput) => string[] = () => []) {
  const calls: TaggerInput[] = [];
  return { calls, tag: async (input: TaggerInput) => (calls.push(input), themes(input)) };
}

describe("winning chances", () => {
  it("follows the Lichess curve", () => {
    expect(winProbability({ cp: 0 })).toBe(0.5);
    expect(winProbability({ cp: 300 })).toBeCloseTo(0.75, 2);
    expect(winProbability({ mate: 3 })).toBe(1);
    expect(winProbability({ mate: -2 })).toBe(0);
    expect(winProbability({ mate: 0 })).toBe(0); // already checkmated
  });

  it("barely moves when already winning", () => {
    const drop = winProbability({ cp: 900 }) - winProbability({ cp: 600 });
    expect(drop).toBeLessThan(MISTAKE_THRESHOLD);
    expect(winProbability({ cp: 100 }) - winProbability({ cp: -200 })).toBeGreaterThan(MISTAKE_THRESHOLD);
  });

  it("flips, formats and sorts scores", () => {
    expect(flip({ cp: 40 })).toEqual({ cp: -40 });
    expect(flip({ mate: 2 })).toEqual({ mate: -2 });
    expect(formatScore({ cp: 125 })).toBe("+1.25");
    expect(formatScore({ mate: -3 })).toBe("#-3");
    expect(centipawns({ mate: 2 })).toBeGreaterThan(centipawns({ mate: 5 }));
    expect(centipawns({ mate: -2 })).toBeLessThan(-9000);
  });
});

describe("parseInfo (Stockfish output)", () => {
  it("reads the score and line", () => {
    expect(parseInfo("info depth 20 seldepth 28 multipv 1 score cp 34 nodes 300014 nps 729961 time 411 pv e2e4 e7e5 g1f3"))
      .toEqual({ score: { cp: 34 }, pv: ["e2e4", "e7e5", "g1f3"] });
    expect(parseInfo("info depth 5 score mate -2 nodes 100 pv h7h6 d1h5")).toEqual({ score: { mate: -2 }, pv: ["h7h6", "d1h5"] });
  });

  it("ignores bounds, other lines and messages", () => {
    expect(parseInfo("info depth 20 score cp 34 lowerbound nodes 1 pv e2e4")).toBeNull();
    expect(parseInfo("info depth 20 multipv 2 score cp 10 pv d2d4")).toBeNull();
    expect(parseInfo("info string NNUE evaluation enabled")).toBeNull();
    expect(parseInfo("bestmove e2e4 ponder e7e5")).toBeNull();
  });
});

describe("analyseGame", () => {
  it("finds no mistakes when every move is the engine's choice", async () => {
    const a = await analyseGame({ pgn: PGN, colour: "white", openingName: "Italian Game" }, fakeEngine({}), fakeTagger());
    expect(a.mistakes).toEqual([]);
    expect(a.positions).toBe(15);
    expect(a.situations).toContain("phaseOpening");
    expect(a.opening).toEqual({ family: "Italian Game", variation: "Italian Game" });
  });

  it("finds a mistake and tags what it allowed", async () => {
    // White's 5.Nxf7 (ply 8) drops from +1.00 to -3.00; the engine preferred 5.Ng4.
    const engine = fakeEngine({ 8: 100, 9: -300 }, { 8: "e5g4" });
    const tagger = fakeTagger(() => ["fork", "middlegame"]);
    const a = await analyseGame({ pgn: PGN, colour: "white", openingName: "Italian Game" }, engine, tagger);

    expect(a.mistakes).toHaveLength(1);
    const m = a.mistakes[0];
    expect(m).toMatchObject({ ply: 8, moveNumber: 5, playedSan: "Nxf7", bestUci: "e5g4", bestSan: "Ng4", phase: "phaseOpening" });
    expect(m.before).toEqual({ cp: 100 });
    expect(m.after).toEqual({ cp: -300 });
    expect(m.drop).toBeGreaterThan(0.3);
    expect(m.labels).toContain("fork:allowed");
    expect(m.labels).not.toContain("phaseMiddlegame"); // phases are Blindspot's own, not the tagger's

    // The "allowed" line starts with the user's move, then the opponent's best reply line.
    expect(tagger.calls).toHaveLength(1);
    expect(tagger.calls[0].moves[0]).toBe("e5f7");
    expect(tagger.calls[0].cp).toBe(300); // the opponent's view
  });

  it("tags a missed tactic only when the opponent's last move handed over a chance", async () => {
    // Black's 4...Qg5 (ply 7) gives White +4.00 with 5.Nxf7's alternative; White plays something worse.
    const engine = fakeEngine({ 7: 30, 8: 400, 9: 30 }, { 8: "d2d4" });
    const tagger = fakeTagger((input) => (input.moves[0] === "d8g5" ? ["fork"] : []));
    const a = await analyseGame({ pgn: PGN, colour: "white", openingName: null }, engine, tagger);

    const m = a.mistakes[0];
    expect(m.labels).toContain("fork:missed");
    const missed = tagger.calls.find((c) => c.moves[0] === "d8g5")!;
    expect(missed.moves.slice(0, 2)).toEqual(["d8g5", "d2d4"]); // opponent's move, then the best line
    expect(missed.cp).toBe(400);
  });

  it("does not look for a missed tactic when the position was already as good", async () => {
    const engine = fakeEngine({ 7: 400, 8: 400, 9: 30 }, { 8: "d2d4" });
    const tagger = fakeTagger(() => ["fork"]);
    const a = await analyseGame({ pgn: PGN, colour: "white", openingName: null }, engine, tagger);
    expect(a.mistakes[0].labels).toContain("fork:allowed");
    expect(a.mistakes[0].labels).not.toContain("fork:missed");
  });

  it("works from Black's side and handles the final checkmate", async () => {
    // Black's 6...Qxe4+ (ply 11) is fine, but say 5...Qxg2 (ply 9) was a mistake.
    const engine = fakeEngine({ 9: -200, 10: 100 }, { 9: "d4c2" });
    const a = await analyseGame({ pgn: PGN, colour: "black", openingName: null }, engine, fakeTagger());
    expect(a.mistakes.map((m) => m.playedSan)).toEqual(["Qxg2"]);
    expect(a.mistakes[0].before).toEqual({ cp: 200 }); // Black's view
    expect(a.opening).toEqual({ family: "e4", variation: "e4 e5" });
  });
});
