import { describe, expect, it } from "vitest";
import { assignOpenings, describeOpening, familyName, gameOpening, OFFBEAT, variationName } from "../src/lib/analysis/openings";

describe("opening names", () => {
  it("drops trailing moves and finds the family", () => {
    expect(variationName("Sicilian Defense Najdorf Variation 6.Be3 e5")).toBe("Sicilian Defense Najdorf Variation");
    expect(variationName("Queens Pawn Opening Accelerated London System 2...c5 3.c3")).toBe("Queens Pawn Opening Accelerated London System");
    expect(familyName("Sicilian Defense Najdorf Variation")).toBe("Sicilian Defense");
    expect(familyName("Queens Pawn Opening Accelerated London System")).toBe("Queens Pawn Opening");
    expect(familyName("Vienna")).toBe("Vienna");
  });

  it("groups White by variation and Black by the user's reply", () => {
    expect(gameOpening("white", "Italian Game Two Knights Defense 4.d3", ["e4", "e5"]))
      .toEqual({ family: "Italian Game", variation: "Italian Game Two Knights Defense" });
    expect(gameOpening("black", "Sicilian Defense Najdorf Variation", ["e4", "c5"])).toEqual({ family: "e4", variation: "e4 c5" });
    expect(gameOpening("white", null, [])).toEqual({ family: "Unknown opening", variation: "Unknown opening" });
  });

  it("names the labels", () => {
    expect(describeOpening("opening:w:Italian Game Two Knights Defense")).toBe("Italian Game Two Knights Defense (as White)");
    expect(describeOpening("opening:b:e4 c5")).toBe("Your reply to 1.e4: 1...c5");
    expect(describeOpening("opening:bf:d4")).toBe("Your other replies to 1.d4");
    expect(describeOpening(OFFBEAT)).toBe("Offbeat openings");
  });
});

describe("assignOpenings", () => {
  it("rolls rare openings up to the family, then into Offbeat", () => {
    let id = 0;
    const games = [
      ...Array.from({ length: 6 }, () => ({ id: ++id, colour: "white" as const, opening: { family: "Italian Game", variation: "Italian Game Giuoco Piano" } })),
      ...Array.from({ length: 3 }, () => ({ id: ++id, colour: "white" as const, opening: { family: "Italian Game", variation: "Italian Game Evans Gambit" } })),
      ...Array.from({ length: 2 }, () => ({ id: ++id, colour: "white" as const, opening: { family: "Italian Game", variation: "Italian Game Two Knights" } })),
      ...Array.from({ length: 2 }, () => ({ id: ++id, colour: "black" as const, opening: { family: "e4", variation: "e4 c5" } })),
      { id: ++id, colour: "white" as const, opening: { family: "Bird Opening", variation: "Bird Opening" } },
    ];
    const out = assignOpenings(games);
    expect(out.get(1)).toBe("opening:w:Italian Game Giuoco Piano");
    expect(out.get(7)).toBe("opening:wf:Italian Game"); // 3 Evans + 2 Two Knights = 5 in the family
    expect(out.get(10)).toBe("opening:wf:Italian Game");
    expect(out.get(12)).toBe(OFFBEAT); // only 2 Sicilian games as Black
    expect(out.get(14)).toBe(OFFBEAT);
  });
});
