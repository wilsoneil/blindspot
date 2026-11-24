import { describe, expect, it } from "vitest";
import { LABELS, labelsForThemes } from "../src/lib/labels";
import { parsePuzzleLine, PuzzleFilter } from "../src/lib/puzzles";

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
