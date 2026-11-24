import { describe, expect, it } from "vitest";
import { LABELS, labelsForThemes, OWN_GAME_LABELS, QUALIFYING_LABELS } from "../src/lib/labels";
import { FilterReport, parsePuzzleLine, PuzzleFilter } from "../src/lib/puzzles";

// Made-up puzzle lines in the Lichess CSV format.
const line = (id: string, rating: number, themes: string, popularity = 90, plays = 500, rd = 75) =>
  `${id},r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3,f1c4 g8f6,${rating},${rd},${popularity},${plays},${themes},https://lichess.org/xxxx,Italian_Game Italian_Game_Two_Knights_Defense`;

describe("labels", () => {
  it("has unique ids", () => {
    const ids = LABELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps Lichess themes to labels", () => {
    expect(labelsForThemes(["fork", "mateIn2", "middlegame", "unknownTheme"]).sort())
      .toEqual(["fork", "phaseMiddlegame", "shortMate"]);
    expect(labelsForThemes(["discoveredCheck", "doubleCheck"])).toEqual(["discoveredOrDoubleCheck"]);
  });

  it("covers the labels added after the Nov 2026 filter report", () => {
    expect(labelsForThemes(["kingsideAttack", "queensideAttack", "zugzwang", "equality"]).sort())
      .toEqual(["defending", "kingsideAttack", "queensideAttack", "zugzwang"]);
    expect(labelsForThemes(["advantage", "crushing", "enPassant", "castling"])).toEqual([]);
  });

  it("trains defending with both Lichess puzzles and own-game positions", () => {
    const defending = LABELS.find((l) => l.id === "defending")!;
    expect(defending.lichessThemes).toEqual(["equality"]);
    expect(OWN_GAME_LABELS.map((l) => l.id)).toContain("defending");
    expect(QUALIFYING_LABELS.has("defending")).toBe(true);
  });
});

describe("parsePuzzleLine", () => {
  it("reads a puzzle", () => {
    const p = parsePuzzleLine(line("abc12", 1500, "fork middlegame short"))!;
    expect(p).toMatchObject({ id: "abc12", rating: 1500, moves: "f1c4 g8f6", nb_plays: 500 });
    expect(p.opening_tags).toEqual(["Italian_Game", "Italian_Game_Two_Knights_Defense"]);
    expect(p.labels.sort()).toEqual(["fork", "phaseMiddlegame"]);
  });

  it("skips the header and broken lines", () => {
    expect(parsePuzzleLine("PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags")).toBeNull();
    expect(parsePuzzleLine("garbage")).toBeNull();
  });
});

describe("PuzzleFilter", () => {
  const opts = { minPopularity: 60, minPlays: 50, maxRatingDeviation: 100, perLabelBandCap: 2, maxTotal: 100 };

  it("drops unpopular, little-played, unsettled and untagged puzzles", () => {
    const f = new PuzzleFilter(opts);
    expect(f.accept(parsePuzzleLine(line("a", 1500, "fork", 10))!)).toBe(false);
    expect(f.accept(parsePuzzleLine(line("b", 1500, "fork", 90, 5))!)).toBe(false);
    expect(f.accept(parsePuzzleLine(line("c", 1500, "fork", 90, 500, 300))!)).toBe(false);
    expect(f.accept(parsePuzzleLine(line("d", 1500, "middlegame short"))!)).toBe(false); // phase only
    expect(f.accept(parsePuzzleLine(line("e", 1500, "fork"))!)).toBe(true);
  });

  it("caps each label per 100-point rating band", () => {
    const f = new PuzzleFilter(opts);
    expect(f.accept(parsePuzzleLine(line("1", 1510, "pin"))!)).toBe(true);
    expect(f.accept(parsePuzzleLine(line("2", 1590, "pin"))!)).toBe(true);
    expect(f.accept(parsePuzzleLine(line("3", 1550, "pin"))!)).toBe(false); // 1500s band full
    expect(f.accept(parsePuzzleLine(line("4", 1650, "pin"))!)).toBe(true); // 1600s band has room
    expect(f.accept(parsePuzzleLine(line("5", 1550, "pin skewer"))!)).toBe(true); // skewer still has room
    expect(f.perLabel.get("pin")).toBe(4);
  });

  it("stops at the total cap", () => {
    const f = new PuzzleFilter({ ...opts, perLabelBandCap: 100, maxTotal: 2 });
    f.accept(parsePuzzleLine(line("1", 1500, "fork"))!);
    f.accept(parsePuzzleLine(line("2", 1500, "fork"))!);
    expect(f.isFull()).toBe(true);
    expect(f.accept(parsePuzzleLine(line("3", 1500, "fork"))!)).toBe(false);
  });
});

describe("drop reasons and report", () => {
  const opts = { minPopularity: 60, minPlays: 50, maxRatingDeviation: 100, perLabelBandCap: 1, maxTotal: 100 };

  it("names why each puzzle was left out", () => {
    const f = new PuzzleFilter(opts);
    const d = (l: string) => f.decide(parsePuzzleLine(l)!);
    expect(d(line("a", 1500, "fork", 10))).toBe("lowPopularity");
    expect(d(line("b", 1500, "fork", 90, 5))).toBe("fewPlays");
    expect(d(line("c", 1500, "fork", 90, 500, 300))).toBe("unsettledRating");
    expect(d(line("d", 1500, "middlegame short"))).toBe("phaseOnly");
    expect(d(line("e", 1500, "crushing long"))).toBe("noLabel");
    expect(d(line("f", 1500, "fork"))).toBe("kept");
    expect(d(line("g", 1550, "fork"))).toBe("bandFull");
    expect(f.decisions.get("kept")).toBe(1);
    expect(f.decisions.get("bandFull")).toBe(1);
  });

  it("counts unused themes and what candidate labels would add", () => {
    const f = new PuzzleFilter(opts);
    const r = new FilterReport(opts);
    for (const l of [
      line("1", 1500, "crushing middlegame long"), // left out: no label
      line("2", 1520, "crushing middlegame long"), // same band: the candidate cap of 1 is full
      line("3", 1650, "advantage endgame"), // another band: would be added
      line("4", 1500, "fork crushing"), // kept already, so not "left out"
      line("5", 1500, "crushing", 10), // poor quality: ignored by the report
      line("6", 1700, "castling middlegame"), // castling candidate, left out
    ]) {
      const p = parsePuzzleLine(l)!;
      r.record(p, f.decide(p));
    }
    expect(r.candidates.get("Converting (advantage/crushing)")).toEqual({ goodQuality: 4, leftOut: 3, wouldAdd: 2 });
    expect(r.candidates.get("Castling")).toEqual({ goodQuality: 1, leftOut: 1, wouldAdd: 1 });
    expect(Object.fromEntries(r.topUnusedThemes())).toMatchObject({ crushing: 2, middlegame: 3, long: 2, advantage: 1, castling: 1 });
  });
});
