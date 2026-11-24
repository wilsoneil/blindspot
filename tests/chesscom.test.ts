import { describe, expect, it } from "vitest";
import { openingNameFromUrl, outcome, parseClocks, planArchives, toGameRow, type ChessComGame } from "../src/lib/chesscom";

// A made-up game between invented players: never use real games in tests.
const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "TestPlayer"]
[Black "Opponent_123"]
[Result "1-0"]
[ECO "C50"]
[ECOUrl "https://www.chess.com/openings/Italian-Game"]
[TimeControl "300"]

1. e4 {[%clk 0:04:59.9]} 1... e5 {[%clk 0:04:58.1]} 2. Nf3 {[%clk 0:04:57]} 2... Nc6 {[%clk 0:04:55.5]} 3. Bc4 {[%clk 0:04:50.2]} 1-0`;

const game: ChessComGame = {
  url: "https://www.chess.com/game/live/111111111",
  pgn: PGN,
  time_control: "300",
  time_class: "blitz",
  end_time: 1767225600, // 1 Jan 2026 00:00 UTC
  rated: true,
  rules: "chess",
  eco: "https://www.chess.com/openings/Italian-Game-Two-Knights-Defense",
  white: { username: "TestPlayer", rating: 1200, result: "win" },
  black: { username: "Opponent_123", rating: 1180, result: "resigned" },
};

describe("toGameRow", () => {
  it("reads a game from the user's side", () => {
    const row = toGameRow(game, "testplayer", "user-1")!;
    expect(row).toMatchObject({
      user_id: "user-1",
      source_game_id: "live/111111111",
      played_at: "2026-01-01T00:00:00.000Z",
      colour: "white",
      user_rating: 1200,
      opponent_rating: 1180,
      result: "win",
      result_detail: "resigned",
      eco: "C50",
      opening_name: "Italian Game Two Knights Defense",
      time_control: "300",
    });
    expect(row.clocks).toEqual([2999, 2981, 2970, 2955, 2902]);
  });

  it("works for the black pieces", () => {
    const row = toGameRow(game, "Opponent_123", "user-1")!;
    expect(row.colour).toBe("black");
    expect(row.result).toBe("loss");
    expect(row.user_rating).toBe(1180);
  });

  it("skips variants and games the user didn't play", () => {
    expect(toGameRow({ ...game, rules: "chess960" }, "testplayer", "u")).toBeNull();
    expect(toGameRow(game, "someoneelse", "u")).toBeNull();
    expect(toGameRow({ ...game, pgn: undefined }, "testplayer", "u")).toBeNull();
  });
});

describe("helpers", () => {
  it("maps chess.com result codes", () => {
    expect(outcome("win")).toBe("win");
    expect(outcome("repetition")).toBe("draw");
    expect(outcome("timevsinsufficient")).toBe("draw");
    expect(outcome("timeout")).toBe("loss");
    expect(outcome("checkmated")).toBe("loss");
  });

  it("parses clocks with large hour counts, for daily games", () => {
    expect(parseClocks("1. e4 {[%clk 23:59:59]} 1... e5 {[%clk 71:59:59.5]}")).toEqual([863990, 2591995]);
  });

  it("names openings from chess.com links", () => {
    expect(openingNameFromUrl("https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation-6.Be3"))
      .toBe("Sicilian Defense Najdorf Variation 6.Be3");
    expect(openingNameFromUrl(undefined)).toBeNull();
  });
});

describe("planArchives", () => {
  const base = "https://api.chess.com/pub/player/testplayer/games";
  const urls = ["2024/10", "2025/11", "2025/12", "2026/06", "2026/11"].map((m) => `${base}/${m}`);
  const now = new Date("2026-11-24T12:00:00Z");

  it("keeps the last 12 months and marks only the current month as unfinished", () => {
    expect(planArchives(urls, 12, now)).toEqual([
      { url: `${base}/2025/12`, complete: true },
      { url: `${base}/2026/06`, complete: true },
      { url: `${base}/2026/11`, complete: false },
    ]);
  });

  it("keeps everything when the window is 'all games'", () => {
    expect(planArchives(urls, null, now)).toHaveLength(5);
  });
});
