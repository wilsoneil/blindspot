import { describe, expect, it } from "vitest";
import { lichessTag, openingCandidates, whiteCandidates } from "../src/lib/training/openings";
import { selectFor, weaknessFromKey } from "../src/lib/training/sources";
import { fakeDb } from "./fake-db";

describe("lichessTag", () => {
  it("writes chess.com names the way Lichess OpeningTags are written", () => {
    expect(lichessTag("Italian Game Two Knights Defense")).toBe("Italian_Game_Two_Knights_Defense");
    expect(lichessTag("King's Indian Defense")).toBe("Kings_Indian_Defense");
    expect(lichessTag("Caro-Kann Defense")).toBe("Caro-Kann_Defense");
    expect(lichessTag("Grünfeld Defense")).toBe("Grunfeld_Defense");
    expect(lichessTag("Queen's Gambit Declined: Exchange")).toBe("Queens_Gambit_Declined_Exchange");
  });
});

describe("openingCandidates", () => {
  it("tries a White variation from most specific down to its family", () => {
    expect(whiteCandidates("Italian Game Two Knights Defense")).toEqual([
      "Italian_Game_Two_Knights_Defense", "Italian_Game_Two_Knights", "Italian_Game_Two", "Italian_Game",
    ]);
    expect(openingCandidates("opening:w:Ruy Lopez Opening Berlin Defense")[0]).toEqual(["Ruy_Lopez_Opening_Berlin_Defense"]);
    expect(openingCandidates("opening:wf:Italian Game")).toEqual([["Italian_Game"]]);
  });

  it("maps the user's reply as Black to the Lichess families it leads to", () => {
    expect(openingCandidates("opening:b:e4 c5")).toEqual([["Sicilian_Defense"]]);
    expect(openingCandidates("opening:b:e4 e5")[0]).toContain("Ruy_Lopez");
    expect(openingCandidates("opening:b:d4 Nf6")[0]).toContain("Kings_Indian_Defense");
  });

  it("falls back to everything after White's first move for an unusual reply", () => {
    const tags = openingCandidates("opening:b:e4 a6")[0];
    expect(tags).toContain("Sicilian_Defense");
    expect(tags).toContain("Italian_Game");
    expect(openingCandidates("opening:bf:c4")).toEqual([["English_Opening"]]);
  });

  it("can't train Offbeat openings or unknown first moves", () => {
    expect(openingCandidates("opening:offbeat")).toEqual([]);
    expect(openingCandidates("opening:bf:a3")).toEqual([]);
    expect(weaknessFromKey("opening:offbeat")).toBeNull();
    expect(weaknessFromKey("opening:b:e4 c5")).toEqual({ key: "opening:b:e4 c5", kind: "opening", candidates: [["Sicilian_Defense"]] });
  });
});

describe("selecting puzzles for an opening", () => {
  const puzzle = (id: string, tags: string[]) => ({
    id, fen: "8/8/8/8/8/8/8/8 w - - 0 1", moves: "a2a3 a7a6", rating: 1500, themes: [], labels: ["fork"], opening_tags: tags,
  });

  it("prefers the specific variation, then fills up from the family", async () => {
    const { db } = fakeDb({
      puzzles: [
        puzzle("v1", ["Italian_Game", "Italian_Game_Two_Knights_Defense"]),
        puzzle("v2", ["Italian_Game", "Italian_Game_Two_Knights_Defense"]),
        puzzle("f1", ["Italian_Game", "Italian_Game_Giuoco_Piano"]),
        puzzle("f2", ["Italian_Game"]),
        puzzle("x1", ["Sicilian_Defense"]),
      ],
      puzzle_attempts: [],
    });
    const w = weaknessFromKey("opening:w:Italian Game Two Knights Defense")!;
    const two = await selectFor(db, w, { userId: "u1", count: 2, level: 1500 });
    expect(two.map((p) => p.id).sort()).toEqual(["v1", "v2"]);
    const four = await selectFor(db, w, { userId: "u1", count: 10, level: 1500 });
    expect(four.map((p) => p.id).sort()).toEqual(["f1", "f2", "v1", "v2"]);
  });

  it("matches any of a Black reply's families", async () => {
    const { db } = fakeDb({
      puzzles: [puzzle("r1", ["Ruy_Lopez"]), puzzle("s1", ["Scotch_Game"]), puzzle("x1", ["Sicilian_Defense"])],
      puzzle_attempts: [],
    });
    const got = await selectFor(db, weaknessFromKey("opening:b:e4 e5")!, { userId: "u1", count: 10, level: 1500 });
    expect(got.map((p) => p.id).sort()).toEqual(["r1", "s1"]);
  });
});
