import { describe, expect, it } from "vitest";
import { buildProfile, describeKey, MIN_GAMES, type ProfileGame, type ProfileMistake } from "../src/lib/analysis/profile";

const NOW = new Date("2026-11-01T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

// Made-up games: all White, same opening, all reaching the opening, transition and middlegame.
function games(n: number, extra: string[] = [], age = 10): ProfileGame[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    playedAt: daysAgo(age),
    colour: "white" as const,
    opening: { family: "Italian Game", variation: "Italian Game Giuoco Piano" },
    situations: ["phaseOpening", "phaseTransition", "phaseMiddlegame", "balanced", "pawnDecisions", ...extra],
  }));
}

const mistake = (gameId: number, labels: string[], drop = 0.3, phase = "phaseMiddlegame", age = 10): ProfileMistake => ({
  gameId, playedAt: daysAgo(age), drop, phase, labels: [phase, ...labels],
});

const opts = { halfLifeDays: 60, gamesWeightPct: 70, now: NOW, countPuzzles: async () => 1000 };

describe("buildProfile", () => {
  it("ranks the costliest category first and scales severity 0-100", async () => {
    const g = games(20);
    const m = [
      ...[1, 2, 3, 4, 5, 6].map((id) => mistake(id, ["fork:allowed"], 0.5)),
      ...[7, 8, 9].map((id) => mistake(id, ["pin:allowed"], 0.2)),
    ];
    const p = await buildProfile(g, m, opts);
    const forkAllowed = p.all.find((e) => e.key === "fork:allowed")!;
    expect(p.top[0].key).toBe("fork:allowed");
    expect(forkAllowed).toMatchObject({ name: "Fork (allowed)", severity: 100, mistakes: 6, games: 6 });
    expect(Math.min(...p.all.map((e) => e.severity))).toBe(0);
    expect(p.all.find((e) => e.key === "pin:allowed")!.score).toBeLessThan(forkAllowed.score);
    expect(p).toMatchObject({ gamesAnalysed: 20, mistakes: 9 });
  });

  it(`needs mistakes in at least ${MIN_GAMES} distinct games`, async () => {
    const m = [mistake(1, ["skewer:missed"], 0.9), mistake(1, ["skewer:missed"], 0.9), mistake(2, ["skewer:missed"], 0.9)];
    const p = await buildProfile(games(20), m, opts);
    expect(p.all.map((e) => e.key)).not.toContain("skewer:missed");
  });

  it("counts recent mistakes more", async () => {
    const m = [
      ...[1, 2, 3, 4].map((id) => mistake(id, ["fork:allowed"], 0.3, "phaseMiddlegame", 5)),
      ...[5, 6, 7, 8].map((id) => mistake(id, ["pin:allowed"], 0.3, "phaseMiddlegame", 200)),
    ];
    const p = await buildProfile(games(20), m, opts);
    const score = (k: string) => p.all.find((e) => e.key === k)!.score;
    expect(score("fork:allowed")).toBeGreaterThan(score("pin:allowed"));
  });

  it("divides by how often the situation arose", async () => {
    // Same mistakes, but rook endgames arose in only 4 games and pawn endgames in all 20.
    const g = games(20, ["pawnEndgame"]).map((x) => (x.id <= 4 ? { ...x, situations: [...x.situations, "rookEndgame"] } : x));
    const m = [1, 2, 3, 4].flatMap((id) => [mistake(id, ["rookEndgame"]), mistake(id + 4, ["pawnEndgame"])]);
    const p = await buildProfile(g, m, opts);
    const score = (k: string) => p.all.find((e) => e.key === k)!.score;
    expect(score("rookEndgame")).toBeGreaterThan(score("pawnEndgame"));
  });

  it("counts opening mistakes towards the game's opening only in the opening and transition", async () => {
    const m = [1, 2, 3, 4, 5].map((id) => mistake(id, [], 0.3, "phaseOpening"));
    const late = [6, 7, 8, 9, 10].map((id) => mistake(id, [], 0.3, "phaseMiddlegame"));
    const p = await buildProfile(games(20), [...m, ...late], opts);
    const opening = p.all.find((e) => e.key === "opening:w:Italian Game Giuoco Piano")!;
    expect(opening).toMatchObject({ mistakes: 5, name: "Italian Game Giuoco Piano (as White)" });
  });

  it("blends in puzzle performance when there is some", async () => {
    const m = [1, 2, 3, 4].flatMap((id) => [mistake(id, ["fork:allowed"]), mistake(id + 4, ["pin:allowed"])]);
    const without = await buildProfile(games(20), m, opts);
    const withPuzzles = await buildProfile(games(20), m, { ...opts, puzzleScores: new Map([["pin:allowed", 20]]) });
    const score = (p: typeof without, k: string) => p.all.find((e) => e.key === k)!.score;
    expect(score(without, "fork:allowed")).toBeCloseTo(score(without, "pin:allowed"));
    expect(score(withPuzzles, "pin:allowed")).toBeGreaterThan(score(withPuzzles, "fork:allowed"));
  });
});

describe("pairs", () => {
  // Forks allowed cluster in the endgame (games 1-10), while other mistakes are spread elsewhere.
  const g = games(40, ["phaseEndgame"]);
  const m = [
    ...Array.from({ length: 10 }, (_, i) => mistake(i + 1, ["fork:allowed"], 0.4, "phaseEndgame")),
    ...Array.from({ length: 4 }, (_, i) => mistake(i + 11, ["fork:allowed"], 0.4, "phaseMiddlegame")),
    ...Array.from({ length: 30 }, (_, i) => mistake(i + 1, ["pin:allowed"], 0.3, "phaseMiddlegame")),
  ];

  it("replace their broader label when clearly worse, with enough games and puzzles", async () => {
    const p = await buildProfile(g, m, opts);
    const pair = p.top.find((e) => e.key === "fork:allowed+phaseEndgame");
    expect(pair).toMatchObject({ name: "Fork (allowed) in the endgame", games: 10, mistakes: 10 });
    // It takes the place of whichever of its two labels scores higher.
    const keys = p.top.map((e) => e.key);
    expect(keys.includes("fork:allowed") && keys.includes("phaseEndgame")).toBe(false);
    expect(describeKey("pawnDecisions+phaseTransition")).toBe("Pawn decisions in the transition");
  });

  it("need at least 200 matching puzzles", async () => {
    const p = await buildProfile(g, m, { ...opts, countPuzzles: async () => 150 });
    expect(p.top.some((e) => e.labels.length === 2)).toBe(false);
    expect(p.top.map((e) => e.key)).toEqual(expect.arrayContaining(["fork:allowed", "phaseEndgame"]));
  });

  it("need at least 8 distinct games", async () => {
    const few = m.filter((x) => !(x.phase === "phaseEndgame" && x.gameId > 7));
    const p = await buildProfile(g, few, opts);
    expect(p.top.map((e) => e.key)).not.toContain("fork:allowed+phaseEndgame");
  });

  it("are at most two of the top list", async () => {
    // Three labels, each concentrated in its own context.
    const g2 = games(60, ["phaseEndgame", "defending", "converting"]);
    const cluster = (label: string, context: string, start: number) => [
      ...Array.from({ length: 12 }, (_, i) => mistake(start + i, [label, context], 0.4)),
      ...Array.from({ length: 3 }, (_, i) => mistake(start + 20 + i, [label], 0.1)),
    ];
    const m2 = [
      ...cluster("fork:allowed", "defending", 1),
      ...cluster("pin:allowed", "converting", 13),
      ...cluster("skewer:allowed", "rookEndgame", 25),
      ...Array.from({ length: 40 }, (_, i) => mistake(i + 1, ["hangingPiece:allowed", "balanced"], 0.3)),
    ];
    const p = await buildProfile(g2, m2, opts);
    expect(p.top.filter((e) => e.labels.length === 2).length).toBeLessThanOrEqual(2);
  });
});

describe("names", () => {
  it("reads naturally, with one set of brackets", () => {
    expect(describeKey("shortMate:missed")).toBe("Short mates in 1–2 (missed)");
    expect(describeKey("longMate:allowed")).toBe("Mates in 3 or more (allowed)");
    expect(describeKey("phaseEndgame+shortMate:missed")).toBe("Short mates in 1–2 (missed) in the endgame");
  });
});
