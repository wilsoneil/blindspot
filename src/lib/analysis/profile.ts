// Turns mistakes into a weakness profile (SPEC.md -> "Weakness profile" and "Scoring method").
//
// Pure calculation: no database. The same code runs in the daily job and when settings change.
//
//   1. Count every mistake in each category.
//   2. Weight it by cost: the winning chance it threw away.
//   3. Weight it by recency: exponential decay with the half-life from settings.
//   4. Normalise by exposure: mistakes per game in which the situation arose, compared with
//      the user's average for that family of labels (e.g. one tactic against all tactics).
//   5. Require evidence: small samples are pulled towards the average, and a category needs
//      mistakes in at least three distinct games to enter the top list.
// Then blend with puzzle performance (from Phase 3) and scale 0-100 against each other.

import { describeLabelKey, familyOfKey, LABELS, puzzleLabelForKey } from "../labels";
import { assignOpenings, describeOpening, type GameOpening } from "./openings";

export const MIN_GAMES = 3; // distinct games before a category can enter the top list
export const PRIOR_GAMES = 10; // how hard small samples are pulled towards the average
export const PAIR_MIN_GAMES = 8;
export const PAIR_MIN_LIFT = 1.25; // "clearly worse than the broader label on its own"
export const PAIR_MIN_PUZZLES = 200;
export const PAIR_PRIOR_COST = 1; // pulls a pair's lift towards 1 (about three average mistakes)
export const MAX_PAIRS = 2;
export const TOP_LIST_SIZE = 8; // the most the "number of weaknesses shown" setting allows

export interface ProfileGame {
  id: number;
  playedAt: string;
  colour: "white" | "black";
  opening: GameOpening;
  situations: string[];
}

export interface ProfileMistake {
  gameId: number;
  playedAt: string;
  drop: number;
  phase: string;
  labels: string[];
}

export interface ProfileOptions {
  halfLifeDays: number;
  gamesWeightPct: number;
  now: Date;
  /**
   * Puzzle performance per label key (Phase 3). Must be on the same scale as the game score:
   * 1 = the user's average for that family of labels, higher = weaker.
   */
  puzzleScores?: Map<string, number>;
  /** How many stored Lichess puzzles carry all these puzzle-store labels. */
  countPuzzles: (labels: string[]) => Promise<number>;
}

export interface WeaknessEntry {
  key: string;
  labels: string[];
  name: string;
  /** 0-100, against the user's other categories. */
  severity: number;
  /** Blended score: 1 = average for its family; 2 = twice as costly as usual. */
  score: number;
  /** Mistakes and distinct games behind it (not weighted). */
  mistakes: number;
  games: number;
}

export interface Profile {
  /** The top list, worst first (up to TOP_LIST_SIZE); the home page shows the first few. */
  top: WeaknessEntry[];
  /** Every single category that passed the evidence rule, worst first. */
  all: WeaknessEntry[];
  gamesAnalysed: number;
  mistakes: number;
}

/**
 * Keys that are never scored. "Defensive move (allowed)" = "your move let the opponent play
 * a good defensive move": not something a puzzle can train, and before analysis version 2 it
 * was a catch-all for positional mistakes. "Defensive move (missed)" is kept.
 */
export const NOT_SCORED = new Set(["defensiveMove:allowed"]);

const TACTIC_KEYS = LABELS.filter((l) => l.missedAllowed)
  .flatMap((l) => [`${l.id}:missed`, `${l.id}:allowed`])
  .filter((k) => !NOT_SCORED.has(k));
const COMPUTED_KEYS = LABELS.filter((l) => !l.missedAllowed).map((l) => l.id);
const EARLY_PHASES = new Set(["phaseOpening", "phaseTransition"]);

interface Stats {
  cost: number; // weighted mistake cost
  exposure: number; // weighted games in which the situation arose
  mistakes: number;
  games: Set<number>;
}

const newStats = (): Stats => ({ cost: 0, exposure: 0, mistakes: 0, games: new Set() });

/** Display name of any key, including openings and pairs. */
export function describeKey(key: string): string {
  if (key.includes("+")) {
    const [a, b] = key.split("+");
    return describePair(a, b);
  }
  return key.startsWith("opening:") ? describeOpening(key) : describeLabelKey(key);
}

const CONTEXT: Record<string, string> = {
  phaseOpening: "in the opening",
  phaseTransition: "in the transition",
  phaseMiddlegame: "in the middlegame",
  phaseEndgame: "in the endgame",
  rookEndgame: "in rook endgames",
  pawnEndgame: "in pawn endgames",
  bishopEndgame: "in bishop endgames",
  knightEndgame: "in knight endgames",
  queenEndgame: "in queen endgames",
  queenRookEndgame: "in queen and rook endgames",
  converting: "when converting an advantage",
  defending: "when defending a worse position",
  balanced: "in balanced positions",
};

function describePair(a: string, b: string): string {
  if (CONTEXT[b] && !CONTEXT[a]) return `${describeKey(a)} ${CONTEXT[b]}`;
  if (CONTEXT[a] && !CONTEXT[b]) return `${describeKey(b)} ${CONTEXT[a]}`;
  if (CONTEXT[a] && CONTEXT[b]) return `${describeKey(a)}, ${CONTEXT[b].replace(/^in /, "")}`;
  return `${describeKey(a)} + ${describeKey(b)}`;
}

/** Label families that may be paired. Tactics and mates count as one group; phase and endgame type overlap. */
function pairable(a: string, b: string): boolean {
  const group = (k: string) => {
    const f = familyOfKey(k).split(":")[0];
    return f === "tactic" || f === "mate" ? "tactical" : f;
  };
  const [ga, gb] = [group(a), group(b)];
  if (ga === gb || ga === "opening" || gb === "opening" || ga === "unknown" || gb === "unknown") return false;
  const pe = new Set([ga, gb]);
  return !(pe.has("phase") && pe.has("endgame"));
}

export async function buildProfile(games: ProfileGame[], mistakes: ProfileMistake[], o: ProfileOptions): Promise<Profile> {
  const decay = (playedAt: string) => {
    const ageDays = Math.max(0, (o.now.getTime() - new Date(playedAt).getTime()) / 86_400_000);
    return Math.pow(0.5, ageDays / o.halfLifeDays);
  };

  // Openings, with rare ones rolled up.
  const openingOf = assignOpenings(games.map((g) => ({ id: g.id, colour: g.colour, opening: g.opening })));

  // Exposure.
  const stats = new Map<string, Stats>();
  const get = (k: string) => stats.get(k) ?? stats.set(k, newStats()).get(k)!;
  for (const k of [...TACTIC_KEYS, ...COMPUTED_KEYS]) get(k);
  let allGames = 0;
  for (const g of games) {
    const w = decay(g.playedAt);
    allGames += w;
    for (const s of new Set([...g.situations, openingOf.get(g.id)!])) get(s).exposure += w;
  }
  for (const k of TACTIC_KEYS) get(k).exposure = allGames; // a tactic can turn up in any game

  // Mistakes, and every pair of labels on the same mistake.
  const known = new Set(games.map((g) => g.id));
  const pairs = new Map<string, Stats>();
  let totalCost = 0;
  let counted = 0;
  for (const m of mistakes) {
    if (!known.has(m.gameId)) continue;
    counted++;
    const cost = m.drop * decay(m.playedAt);
    totalCost += cost;
    const keys = [...new Set(m.labels)].filter((k) => !NOT_SCORED.has(k));
    if (EARLY_PHASES.has(m.phase)) keys.push(openingOf.get(m.gameId)!);
    for (const k of keys) {
      const s = get(k);
      s.cost += cost;
      s.mistakes++;
      s.games.add(m.gameId);
    }
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        if (!pairable(keys[i], keys[j])) continue;
        const pk = [keys[i], keys[j]].sort().join("+");
        const s = pairs.get(pk) ?? pairs.set(pk, newStats()).get(pk)!;
        s.cost += cost;
        s.mistakes++;
        s.games.add(m.gameId);
      }
    }
  }

  // Family averages, then each category's shrunk score against its family.
  const family = new Map<string, { cost: number; exposure: number }>();
  for (const [k, s] of stats) {
    const f = family.get(familyOfKey(k)) ?? family.set(familyOfKey(k), { cost: 0, exposure: 0 }).get(familyOfKey(k))!;
    f.cost += s.cost;
    f.exposure += s.exposure;
  }
  const w = o.gamesWeightPct / 100;
  const scoreOf = new Map<string, number>();
  for (const [k, s] of stats) {
    const f = family.get(familyOfKey(k))!;
    const avg = f.exposure > 0 ? f.cost / f.exposure : 0;
    const games = avg > 0 ? (s.cost + PRIOR_GAMES * avg) / (s.exposure + PRIOR_GAMES) / avg : 1;
    const puzzles = o.puzzleScores?.get(k);
    scoreOf.set(k, puzzles === undefined ? games : w * games + (1 - w) * puzzles);
  }

  const eligible = [...stats.entries()]
    .filter(([, s]) => s.games.size >= MIN_GAMES)
    .sort((a, b) => scoreOf.get(b[0])! - scoreOf.get(a[0])! || a[0].localeCompare(b[0]));
  const entry = (key: string, labels: string[], s: Stats, score: number): WeaknessEntry => ({
    key, labels, name: describeKey(key), severity: 0, score, mistakes: s.mistakes, games: s.games.size,
  });
  const all = eligible.map(([k, s]) => entry(k, [k], s, scoreOf.get(k)!));

  // Pairs: each can replace the broader of its two labels (the one that scores higher).
  const inTop = new Set(all.slice(0, TOP_LIST_SIZE + MAX_PAIRS).map((e) => e.key));
  const bestPairFor = new Map<string, WeaknessEntry>();
  for (const [pk, s] of pairs) {
    if (s.games.size < PAIR_MIN_GAMES) continue;
    const [a, b] = pk.split("+");
    const parent = scoreOf.get(a)! >= scoreOf.get(b)! ? a : b;
    if (!inTop.has(parent)) continue;
    const expected = (stats.get(a)!.cost * stats.get(b)!.cost) / totalCost;
    const lift = (s.cost + PAIR_PRIOR_COST) / (expected + PAIR_PRIOR_COST);
    if (lift < PAIR_MIN_LIFT) continue;
    const score = scoreOf.get(parent)! * lift;
    if ((bestPairFor.get(parent)?.score ?? 0) >= score) continue;
    if ((await trainingPositions(a, b, s, o)) < PAIR_MIN_PUZZLES) continue;
    bestPairFor.set(parent, entry(pk, [a, b], s, score));
  }

  // The top list: pairs in place of their parents, at most MAX_PAIRS of them.
  const allowedPairs = new Set(
    [...bestPairFor.values()].sort((x, y) => y.score - x.score).slice(0, MAX_PAIRS).map((p) => p.key),
  );
  const top = all
    .map((e) => {
      const pair = bestPairFor.get(e.key);
      return pair && allowedPairs.has(pair.key) ? pair : e;
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, TOP_LIST_SIZE);

  // Scale 0-100 against each other: the worst category (or pair) is 100, the best is 0.
  const scores = [...all, ...top].map((e) => e.score);
  const [hi, lo] = [Math.max(...scores), Math.min(...scores)];
  for (const e of new Set([...all, ...top])) {
    e.severity = hi > lo ? Math.round((100 * (e.score - lo)) / (hi - lo)) : 100;
    e.score = Math.round(e.score * 1000) / 1000;
  }

  return { top, all, gamesAnalysed: games.length, mistakes: counted };
}

/**
 * Positions available to train a pair: Lichess puzzles with both labels, or, when either
 * label is positional (no Lichess theme), the user's own mistakes with both labels.
 */
async function trainingPositions(a: string, b: string, s: Stats, o: ProfileOptions): Promise<number> {
  const [pa, pb] = [puzzleLabelForKey(a), puzzleLabelForKey(b)];
  if (pa && pb) return o.countPuzzles([pa, pb]);
  return s.mistakes;
}
