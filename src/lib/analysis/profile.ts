// Turns mistakes into a weakness profile (SPEC.md -> "Weakness profile" and "Scoring method").
//
// Pure calculation: no database. The same code runs in the daily job and when settings change.
//
//   1. Count every mistake in each category.
//   2. Weight it by cost: the winning chance it threw away.
//   3. Weight it by recency: exponential decay with the half-life from settings.
//   4. Normalise by exposure: mistakes per game in which the situation arose, compared with
//      the user's average for that family of labels (e.g. one tactic against all tactics).
//      Tactics and mates arise in any game, so their exposure is weighted by how common each
//      motif is among Lichess puzzles (motif-frequency.ts).
//   5. Require evidence: small samples are pulled towards the average, and a category needs
//      mistakes in at least three distinct games to enter the top list.
// Then blend with puzzle performance (from Phase 3) and scale 0-100 against each other.

import { describeLabelKey, familyOfKey, labelForKey, LABELS, puzzleLabelForKey } from "../labels";
import { MOTIF_PUZZLES } from "./motif-frequency";
import { assignOpenings, describeOpening, type GameOpening } from "./openings";

export const MIN_GAMES = 3; // distinct games before a category can enter the top list
export const PRIOR_GAMES = 10; // how hard small samples are pulled towards the average
export const PAIR_MIN_GAMES = 8;
export const PAIR_MIN_LIFT = 1.25; // "clearly worse than the broader label on its own"
export const PAIR_MIN_PUZZLES = 200;
/** For a pair trained with the user's own positions (each is used once), fewer will do. */
export const PAIR_MIN_OWN_POSITIONS = 25;
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
  /**
   * How often each tactic and mate appears among Lichess puzzles (label id -> count), for the
   * exposure of tactics and mates. Defaults to the counts from the full Lichess file.
   */
  motifFrequency?: Record<string, number>;
  /** Also return `review`: why each pair was or wasn't used, and how each family fares (the profile check page). */
  review?: boolean;
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
  /**
   * Share of winning chance it costs per game (0-1), recency-weighted, from games only: an
   * absolute measure, so its history can show improvement (the score is relative).
   */
  perGame: number;
}

export interface Profile {
  /** The top list, worst first (up to TOP_LIST_SIZE); the home page shows the first few. */
  top: WeaknessEntry[];
  /** Every single category that passed the evidence rule, worst first. */
  all: WeaknessEntry[];
  gamesAnalysed: number;
  mistakes: number;
  /** Only when asked for (`review: true`); never saved. */
  review?: ProfileReview;
}

/** What happened to a pair with enough games: the first rule it failed, or how it fared. */
export type PairOutcome =
  | "shown" // replaces its broader label in the top list
  | "parentNotInTop" // its broader label isn't near the top, so it couldn't matter
  | "notClearlyWorse" // lift below PAIR_MIN_LIFT
  | "fewPositions" // under PAIR_MIN_PUZZLES puzzles, or PAIR_MIN_OWN_POSITIONS own positions
  | "anotherPairBetter" // another pair scored higher for the same broader label
  | "pairLimit" // passed, but MAX_PAIRS stronger pairs were already in
  | "outOfTop"; // passed, but still not high enough for the top list

export interface PairCheck {
  key: string;
  name: string;
  /** The broader label it would replace. */
  parent: string;
  games: number;
  mistakes: number;
  lift: number;
  score: number;
  /** True when it is trained with the user's own positions (its own mistakes), not Lichess puzzles. */
  positional: boolean;
  /** Matching Lichess puzzles, or own positions for a positional pair. */
  positions: number;
  outcome: PairOutcome;
}

export interface FamilyCheck {
  family: string;
  /** Categories in the family (everything scored, even with no mistakes). */
  labels: number;
  /** Categories with mistakes in at least MIN_GAMES games. */
  eligible: number;
  inTop5: number;
  inTop8: number;
  highest: number;
}

export interface ProfileReview {
  pairs: PairCheck[];
  families: FamilyCheck[];
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

/**
 * Each tactic or mate key's exposure as a multiple of all games: its share of its family's
 * puzzle count, times the number of keys in the family (so the family's total is unchanged,
 * and equal counts give every key 1, the old "any game" exposure).
 */
function tacticShares(freq: Record<string, number>): (key: string) => number {
  const known = (k: string) => freq[k.split(":")[0]] ?? 0;
  const byFamily = new Map<string, string[]>();
  for (const k of TACTIC_KEYS) byFamily.set(familyOfKey(k), [...(byFamily.get(familyOfKey(k)) ?? []), k]);
  const share = new Map<string, number>();
  for (const keys of byFamily.values()) {
    const counted = keys.filter((k) => known(k) > 0);
    // A motif missing from the counts is taken as average for its family; no counts at all = all equal.
    const fill = counted.length ? counted.reduce((n, k) => n + known(k), 0) / counted.length : 1;
    const count = (k: string) => (known(k) > 0 ? known(k) : fill);
    const total = keys.reduce((n, k) => n + count(k), 0);
    for (const k of keys) share.set(k, (keys.length * count(k)) / total);
  }
  return (k) => share.get(k) ?? 1;
}

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
  // A tactic can turn up in any game, but some motifs far more often than others. Each gets
  // its usual share of the family's games, from how often it appears among Lichess puzzles
  // (taken from real games), so a common motif isn't a weakness just for being common.
  const motifShare = tacticShares(o.motifFrequency ?? MOTIF_PUZZLES);
  for (const k of TACTIC_KEYS) get(k).exposure = allGames * motifShare(k);

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
    perGame: allGames > 0 ? s.cost / allGames : 0,
  });
  const all = eligible.map(([k, s]) => entry(k, [k], s, scoreOf.get(k)!));

  // Pairs: each can replace the broader of its two labels (the one that scores higher).
  const inTop = new Set(all.slice(0, TOP_LIST_SIZE + MAX_PAIRS).map((e) => e.key));
  const bestPairFor = new Map<string, WeaknessEntry>();
  const checks: PairCheck[] = [];
  // The review counts positions for every pair: ask the database for them in parallel, not one by one.
  const reviewPositions = new Map<string, TrainingPositions>();
  if (o.review) {
    const todo = [...pairs].filter(([, s]) => s.games.size >= PAIR_MIN_GAMES);
    for (let i = 0; i < todo.length; i += 10) {
      await Promise.all(todo.slice(i, i + 10).map(async ([pk, s]) => {
        const [a, b] = pk.split("+");
        reviewPositions.set(pk, await trainingPositions(a, b, s, o));
      }));
    }
  }
  for (const [pk, s] of pairs) {
    if (s.games.size < PAIR_MIN_GAMES) continue;
    const [a, b] = pk.split("+");
    const parent = scoreOf.get(a)! >= scoreOf.get(b)! ? a : b;
    const expected = (stats.get(a)!.cost * stats.get(b)!.cost) / totalCost;
    const lift = (s.cost + PAIR_PRIOR_COST) / (expected + PAIR_PRIOR_COST);
    const score = scoreOf.get(parent)! * lift;
    const failed: PairOutcome | null =
      !inTop.has(parent) ? "parentNotInTop" : lift < PAIR_MIN_LIFT ? "notClearlyWorse" : null;
    if (o.review) {
      const t = reviewPositions.get(pk)!;
      checks.push({
        key: pk, name: describeKey(pk), parent, games: s.games.size, mistakes: s.mistakes, lift, score,
        positional: t.own, positions: t.count,
        outcome: failed ?? (enough(t) ? "anotherPairBetter" : "fewPositions"), // settled below
      });
    }
    if (failed) continue;
    if ((bestPairFor.get(parent)?.score ?? 0) >= score) continue;
    if (!enough(await trainingPositions(a, b, s, o))) continue;
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
    e.perGame = Math.round(e.perGame * 1e5) / 1e5;
  }

  const profile: Profile = { top, all, gamesAnalysed: games.length, mistakes: counted };
  if (o.review) {
    const pairChecks = settlePairs(checks, bestPairFor, allowedPairs, top);
    profile.review = { pairs: pairChecks, families: familyChecks(stats, all, top, pairChecks) };
  }
  return profile;
}

function settlePairs(
  checks: PairCheck[], best: Map<string, WeaknessEntry>, allowed: Set<string>, top: WeaknessEntry[],
): PairCheck[] {
  const inTop = new Set(top.map((e) => e.key));
  for (const c of checks) {
    if (c.outcome !== "anotherPairBetter" || best.get(c.parent)?.key !== c.key) continue;
    c.outcome = !allowed.has(c.key) ? "pairLimit" : inTop.has(c.key) ? "shown" : "outOfTop";
  }
  for (const c of checks) {
    c.lift = Math.round(c.lift * 100) / 100;
    c.score = Math.round(c.score * 1000) / 1000;
  }
  return checks.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key));
}

/** How each family fares, to see whether big families (tactics) crowd out small ones. */
function familyChecks(
  stats: Map<string, Stats>, all: WeaknessEntry[], top: WeaknessEntry[], pairs: PairCheck[],
): FamilyCheck[] {
  const parentOf = new Map(pairs.map((p) => [p.key, p.parent]));
  const out = new Map<string, FamilyCheck>();
  const get = (f: string) =>
    out.get(f) ?? out.set(f, { family: f, labels: 0, eligible: 0, inTop5: 0, inTop8: 0, highest: 0 }).get(f)!;
  for (const k of stats.keys()) get(familyOfKey(k)).labels++;
  for (const e of all) {
    const f = get(familyOfKey(e.key));
    f.eligible++;
    f.highest = Math.max(f.highest, e.score);
  }
  top.forEach((e, i) => {
    // A pair counts for the family of the broader label it replaced.
    const f = get(familyOfKey(parentOf.get(e.key) ?? e.key));
    if (i < 5) f.inTop5++;
    f.inTop8++;
  });
  return [...out.values()].sort((x, y) => y.inTop8 - x.inTop8 || y.highest - x.highest || x.family.localeCompare(y.family));
}

interface TrainingPositions {
  count: number;
  /** Counted from the user's own mistakes rather than Lichess puzzles. */
  own: boolean;
}

const enough = (t: TrainingPositions) => t.count >= (t.own ? PAIR_MIN_OWN_POSITIONS : PAIR_MIN_PUZZLES);

/**
 * Positions available to train a pair: Lichess puzzles with both labels, or the user's own
 * mistakes with both labels when either label is positional (no Lichess theme), or when the
 * puzzles fall short and either label is also trained from own games (e.g. "defending":
 * no Lichess puzzle is both a long mate and an equality puzzle). Training does the same
 * (src/lib/training/sources.ts).
 */
async function trainingPositions(a: string, b: string, s: Stats, o: ProfileOptions): Promise<TrainingPositions> {
  const [pa, pb] = [puzzleLabelForKey(a), puzzleLabelForKey(b)];
  if (pa && pb) {
    const puzzles = await o.countPuzzles([pa, pb]);
    const ownToo = labelForKey(a)?.fromOwnGames || labelForKey(b)?.fromOwnGames;
    if (puzzles >= PAIR_MIN_PUZZLES || !ownToo) return { count: puzzles, own: false };
  }
  return { count: s.mistakes, own: true };
}
