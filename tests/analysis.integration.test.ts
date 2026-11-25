// End-to-end check with the real Stockfish and Lichess tagger, on a made-up game.
// Skipped unless STOCKFISH_PATH and LICHESS_TAGGER_DIR are set (the analysis workflow sets them).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyseGame } from "../src/lib/analysis/game";
import { Stockfish } from "../scripts/lib/stockfish";
import { LichessTagger } from "../scripts/lib/tagger";

const STOCKFISH = process.env.STOCKFISH_PATH;
const TAGGER = process.env.LICHESS_TAGGER_DIR;

// Légal's trap, a textbook pattern, played by a made-up Black player.
const PGN = `[Event "Made up"]\n\n1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0`;

describe.skipIf(!STOCKFISH || !TAGGER)("analysis with the real engine and tagger", () => {
  let engine: Stockfish;
  let tagger: LichessTagger;

  beforeAll(async () => {
    engine = await Stockfish.start({ path: STOCKFISH!, threads: 1, hashMb: 64, nodes: 300_000 });
    tagger = LichessTagger.start({ python: process.env.PYTHON || "python3", taggerDir: TAGGER!, enginePath: STOCKFISH! });
  });
  afterAll(() => {
    engine?.quit();
    tagger?.quit();
  });

  it("is the pinned engine", async () => {
    expect(await Stockfish.identify(STOCKFISH!)).toMatch(/^Stockfish 17\.1/);
  });

  it("finds Black's mistakes and tags the mate it allowed", async () => {
    const a = await analyseGame({ pgn: PGN, colour: "black", openingName: null }, engine, tagger);
    const bxd1 = a.mistakes.find((m) => m.playedSan === "Bxd1")!;
    expect(bxd1).toBeDefined();
    expect(bxd1.bestSan).toBe("dxe5");
    expect(bxd1.labels).toEqual(expect.arrayContaining(["shortMate:allowed", "recaptureChoice", "phaseOpening"]));
    expect(tagger.errors).toBe(0);
  }, 60_000);

  it("finds nothing wrong with White's play", async () => {
    const a = await analyseGame({ pgn: PGN, colour: "white", openingName: "Philidor Defense" }, engine, tagger);
    expect(a.mistakes).toEqual([]);
  }, 60_000);
});
