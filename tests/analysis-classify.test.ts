import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import {
  developmentDone, endgameTypeOf, isEqualTrade, moveFromUci, moveTypeSituations, moveTypesOf, phaseOf, positionStateOf,
} from "../src/lib/analysis/classify";

const board = (fen: string) => new Chess(fen).board();
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// White has developed and castled; Black hasn't.
const DEVELOPED = "rnbqkbnr/pppp1ppp/8/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 b kq - 5 4";

describe("phase", () => {
  it("knows when development is done", () => {
    expect(developmentDone(board(START), "white")).toBe(false);
    expect(developmentDone(board(DEVELOPED), "white")).toBe(true); // one minor (c1) still home is allowed
    expect(developmentDone(board(DEVELOPED), "black")).toBe(false);
  });

  it("splits a game into opening, transition, middlegame and endgame", () => {
    const b = board(START);
    expect(phaseOf(b, 5, true)).toBe("phaseOpening"); // never before move 10
    expect(phaseOf(b, 12, false)).toBe("phaseOpening"); // not developed yet
    expect(phaseOf(b, 12, true)).toBe("phaseTransition");
    expect(phaseOf(b, 16, false)).toBe("phaseTransition"); // the opening ends by move 15 regardless
    expect(phaseOf(b, 21, true)).toBe("phaseMiddlegame");
    expect(phaseOf(board("4k3/8/8/8/8/8/4P3/R3K2R w - - 0 30"), 30, true)).toBe("phaseEndgame");
    expect(phaseOf(board("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 8"), 8, false)).toBe("phaseEndgame");
  });
});

describe("endgame type", () => {
  it("matches the Lichess endgame themes", () => {
    expect(endgameTypeOf(board("4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 1"))).toBe("pawnEndgame");
    expect(endgameTypeOf(board("r3k3/4p3/8/8/8/8/4P3/R3K3 w - - 0 1"))).toBe("rookEndgame");
    expect(endgameTypeOf(board("4k3/4p3/8/8/8/8/4P3/2B1K3 w - - 0 1"))).toBe("bishopEndgame");
    expect(endgameTypeOf(board("4k3/4p3/5n2/8/8/8/4P3/1N2K3 w - - 0 1"))).toBe("knightEndgame");
    expect(endgameTypeOf(board("3qk3/8/8/8/8/8/8/3QK3 w - - 0 1"))).toBe("queenEndgame");
    expect(endgameTypeOf(board("r3k3/8/8/8/8/8/8/R2QK3 w - - 0 1"))).toBe("queenRookEndgame");
    expect(endgameTypeOf(board("r3k3/8/8/8/8/8/8/2B1K2R w - - 0 1"))).toBeNull(); // mixed pieces
    expect(endgameTypeOf(board(START))).toBeNull();
  });
});

describe("position state", () => {
  it("uses 1.5 pawns either way", () => {
    expect(positionStateOf({ cp: 150 })).toBe("converting");
    expect(positionStateOf({ cp: 149 })).toBe("balanced");
    expect(positionStateOf({ cp: -200 })).toBe("defending");
    expect(positionStateOf({ mate: 4 })).toBe("converting");
    expect(positionStateOf({ mate: -1 })).toBe("defending");
  });
});

describe("move type", () => {
  // Made-up position: Black's knight has just taken on e5, and White can't take back.
  const fen = "r1bqkb1r/pppp1ppp/5n2/4n3/4P3/2N5/PPPP1PPP/R1BQKB1R w KQkq - 0 5";
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  const previous = { to: "e5", captured: "n" as const };

  it("spots equal trades", () => {
    expect(isEqualTrade({ piece: "n", captured: "b" })).toBe(true);
    expect(isEqualTrade({ piece: "r", captured: "r" })).toBe(true);
    expect(isEqualTrade({ piece: "b", captured: "r" })).toBe(false);
    expect(isEqualTrade({ piece: "p", captured: "p" })).toBe(false);
    expect(isEqualTrade({ piece: "n" })).toBe(false);
  });

  it("labels what kind of decision a mistake was", () => {
    const played = moveFromUci(fen, "d2d4")!;
    const best = moveFromUci(fen, "f2f4")!;
    expect(moveTypesOf({ legal, played, best, previous })).toEqual(["pawnDecisions"]);
    const knight = moveFromUci(fen, "c3d5")!;
    expect(moveTypesOf({ legal, played: knight, best: null, previous })).toEqual([]);
  });

  it("labels a recapture choice", () => {
    // Black's pawn has just taken on d5, and White can take back with the e-pawn.
    const f = "rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3";
    const prev = { to: "d5", captured: "p" as const };
    const c = new Chess(f);
    const played = moveFromUci(f, "f3e5")!;
    const best = moveFromUci(f, "e4d5")!;
    expect(moveTypesOf({ legal: c.moves({ verbose: true }), played, best, previous: prev })).toEqual(["pawnDecisions", "recaptureChoice"]);
    expect(moveTypeSituations({ legal: c.moves({ verbose: true }), previous: prev })).toEqual(["pawnDecisions", "recaptureChoice"]);
  });

  it("lists the decisions on offer", () => {
    expect(moveTypeSituations({ legal, previous: null })).toEqual(["pawnDecisions"]);
    expect(moveFromUci(fen, "e1e5")).toBeNull();
  });
});
