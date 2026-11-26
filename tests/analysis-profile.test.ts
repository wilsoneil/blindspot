import { describe, expect, it } from "vitest";
import {
  buildProfile, describeKey, MIN_GAMES, PAIR_MIN_OWN_POSITIONS, type ProfileGame, type ProfileMistake,
} from "../src/lib/analysis/profile";

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

// No motif counts: every tactic is equally common, so these tests don't depend on the Lichess file.
const opts = { halfLifeDays: 60, gamesWeightPct: 70, now: NOW, countPuzzles: async () => 1000, motifFrequency: {} };

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

  it("never scores 'defensive move (allowed)', but keeps the missed side", async () => {
    const m = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((id) => mistake(id, ["defensiveMove:allowed"], 0.6)),
      ...[9, 10, 11].map((id) => mistake(id, ["defensiveMove:missed", "fork:allowed"], 0.3)),
    ];
    const p = await buildProfile(games(20), m, opts);
    const keys = p.all.map((e) => e.key);
    expect(keys).not.toContain("defensiveMove:allowed");
    expect(keys).toContain("defensiveMove:missed");
    expect(keys).toContain("fork:allowed");
    expect(p.top.some((e) => e.key.includes("defensiveMove:allowed"))).toBe(false); // nor in a pair
    expect(p.mistakes).toBe(11); // the mistakes still count, under their other labels
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

  it(`need only ${PAIR_MIN_OWN_POSITIONS} own positions when trained from the user's games`, async () => {
    // Pawn decisions go wrong in the endgame: a positional pair, trained with own positions.
    const withMistakes = (n: number) => [
      ...Array.from({ length: n }, (_, i) => mistake(i + 1, ["pawnDecisions"], 0.4, "phaseEndgame")),
      ...Array.from({ length: 40 }, (_, i) => mistake(i + 1, ["pin:allowed"], 0.3, "phaseMiddlegame")),
    ];
    const pairOf = async (n: number) =>
      (await buildProfile(games(60, ["phaseEndgame"]), withMistakes(n), { ...opts, review: true, countPuzzles: async () => 0 }))
        .review!.pairs.find((x) => x.key === "pawnDecisions+phaseEndgame")!;
    expect(await pairOf(PAIR_MIN_OWN_POSITIONS)).toMatchObject({ positional: true, positions: PAIR_MIN_OWN_POSITIONS, outcome: "shown" });
    expect(await pairOf(PAIR_MIN_OWN_POSITIONS - 1)).toMatchObject({ outcome: "fewPositions" });
  });

  it("count own positions when the puzzles fall short and a label is also trained from own games", async () => {
    // "Defending" also has Lichess equality puzzles, but none is a long mate as well.
    const m2 = [
      ...Array.from({ length: 30 }, (_, i) => mistake(i + 1, ["longMate:allowed", "defending"], 0.5)),
      ...Array.from({ length: 40 }, (_, i) => mistake(i + 1, ["pin:allowed", "balanced"], 0.3)),
    ];
    const r = (await buildProfile(games(60, ["defending"]), m2, { ...opts, review: true, countPuzzles: async () => 0 })).review!;
    expect(r.pairs.find((x) => x.key === "defending+longMate:allowed")).toMatchObject({ positional: true, positions: 30 });
    // Without a label from own games, too few puzzles still means too few.
    const fork = (await buildProfile(g, m, { ...opts, review: true, countPuzzles: async () => 0 })).review!;
    expect(fork.pairs.find((x) => x.key === "fork:allowed+phaseEndgame")).toMatchObject({ positional: false, outcome: "fewPositions" });
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

describe("tactics and mates", () => {
  // Forks are ten times as common as skewers among puzzles; the user misses both equally often.
  const freq = { fork: 1000, skewer: 100, pin: 500 };
  const m = [
    ...Array.from({ length: 8 }, (_, i) => mistake(i + 1, ["fork:missed"], 0.3)),
    ...Array.from({ length: 8 }, (_, i) => mistake(i + 11, ["skewer:missed"], 0.3)),
  ];

  it("are compared with how common each motif is", async () => {
    const p = await buildProfile(games(40), m, { ...opts, motifFrequency: freq });
    const score = (k: string) => p.all.find((e) => e.key === k)!.score;
    // As many skewer mistakes as fork mistakes is unusual: skewers are the weakness.
    expect(score("skewer:missed")).toBeGreaterThan(score("fork:missed"));
  });

  it("score equally when the motifs are equally common", async () => {
    const p = await buildProfile(games(40), m, { ...opts, motifFrequency: { fork: 100, skewer: 100 } });
    const score = (k: string) => p.all.find((e) => e.key === k)!.score;
    expect(score("skewer:missed")).toBeCloseTo(score("fork:missed"), 6);
  });

  it("score alike when the mistakes follow the motifs' usual shares", async () => {
    // Forks twice as common as pins in puzzles, and the user's mistakes split 2:1 the same way.
    // Many games, so the small-sample pull towards 1 hardly matters.
    const split = [
      ...Array.from({ length: 40 }, (_, i) => mistake(i + 1, ["fork:missed"], 0.3)),
      ...Array.from({ length: 20 }, (_, i) => mistake(i + 101, ["pin:missed"], 0.3)),
    ];
    const p = await buildProfile(games(2000), split, { ...opts, motifFrequency: { fork: 200, pin: 100 } });
    const score = (k: string) => p.all.find((e) => e.key === k)!.score;
    expect(score("fork:missed") / score("pin:missed")).toBeCloseTo(1, 1);
  });
});

describe("review (profile check page)", () => {
  const g = games(40, ["phaseEndgame"]);
  const m = [
    ...Array.from({ length: 10 }, (_, i) => mistake(i + 1, ["fork:allowed"], 0.4, "phaseEndgame")),
    ...Array.from({ length: 4 }, (_, i) => mistake(i + 11, ["fork:allowed"], 0.4, "phaseMiddlegame")),
    ...Array.from({ length: 30 }, (_, i) => mistake(i + 1, ["pin:allowed"], 0.3, "phaseMiddlegame")),
  ];

  it("is only built when asked for, and changes nothing", async () => {
    const plain = await buildProfile(g, m, opts);
    const reviewed = await buildProfile(g, m, { ...opts, review: true });
    expect(plain.review).toBeUndefined();
    expect(reviewed.top).toEqual(plain.top);
    expect(reviewed.all).toEqual(plain.all);
  });

  it("says why each pair was or wasn't used", async () => {
    const shown = (await buildProfile(g, m, { ...opts, review: true })).review!;
    expect(shown.pairs.find((x) => x.key === "fork:allowed+phaseEndgame"))
      .toMatchObject({ outcome: "shown", positional: false, positions: 1000, games: 10 });
    const few = (await buildProfile(g, m, { ...opts, review: true, countPuzzles: async () => 150 })).review!;
    expect(few.pairs.find((x) => x.key === "fork:allowed+phaseEndgame")).toMatchObject({ outcome: "fewPositions" });
    expect(shown.pairs.map((x) => x.score)).toEqual([...shown.pairs.map((x) => x.score)].sort((x, y) => y - x));
  });

  it("counts own mistakes as the positions of a positional pair", async () => {
    const g2 = games(40, ["phaseEndgame"]);
    const m2 = [
      ...Array.from({ length: 10 }, (_, i) => mistake(i + 1, ["pawnDecisions"], 0.4, "phaseEndgame")),
      ...Array.from({ length: 30 }, (_, i) => mistake(i + 1, ["pin:allowed"], 0.3, "phaseMiddlegame")),
    ];
    const r = (await buildProfile(g2, m2, { ...opts, review: true })).review!;
    const pair = r.pairs.find((x) => x.key === "pawnDecisions+phaseEndgame")!;
    expect(pair).toMatchObject({ positional: true, positions: 10 });
    expect(["fewPositions", "parentNotInTop", "notClearlyWorse"]).toContain(pair.outcome);
  });

  it("sums up each family, with pairs counted for their broader label", async () => {
    const p = await buildProfile(g, m, { ...opts, review: true });
    const fam = new Map(p.review!.families.map((f) => [f.family, f]));
    expect(fam.get("tactic:allowed")).toMatchObject({ eligible: 2 });
    expect(fam.get("tactic:allowed")!.labels).toBeGreaterThan(10);
    const inTop8 = p.review!.families.reduce((n, f) => n + f.inTop8, 0);
    expect(inTop8).toBe(p.top.length);
  });
});

describe("names", () => {
  it("reads naturally, with one set of brackets", () => {
    expect(describeKey("shortMate:missed")).toBe("Short mates in 1–2 (missed)");
    expect(describeKey("longMate:allowed")).toBe("Mates in 3 or more (allowed)");
    expect(describeKey("phaseEndgame+shortMate:missed")).toBe("Short mates in 1–2 (missed) in the endgame");
  });
});

describe("motif counts", () => {
  it("cover every tactic and mate", async () => {
    const { MOTIF_PUZZLES } = await import("../src/lib/analysis/motif-frequency");
    const { LABELS } = await import("../src/lib/labels");
    for (const l of LABELS.filter((x) => x.missedAllowed)) expect(MOTIF_PUZZLES[l.id]).toBeGreaterThan(0);
  });
});
