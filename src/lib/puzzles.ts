// Filters the Lichess puzzle database (https://database.lichess.org/#puzzles, CC0)
// down to a store small enough for Supabase's free tier.
//
// CSV columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags

import { labelsForThemes, QUALIFYING_LABELS } from "./labels";

export interface PuzzleRow {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  rating_deviation: number;
  popularity: number;
  nb_plays: number;
  themes: string[];
  opening_tags: string[];
  labels: string[];
}

/** One CSV line -> a puzzle, or null for the header or a malformed line. */
export function parsePuzzleLine(line: string): PuzzleRow | null {
  const cols = line.split(",");
  if (cols.length < 9 || cols[0] === "PuzzleId") return null;
  const [id, fen, moves, rating, rd, popularity, plays, themes, , openingTags = ""] = cols;
  const nums = [rating, rd, popularity, plays].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const themeList = themes.split(" ").filter(Boolean);
  return {
    id, fen, moves,
    rating: nums[0], rating_deviation: nums[1], popularity: nums[2], nb_plays: nums[3],
    themes: themeList,
    opening_tags: openingTags.trim().split(" ").filter(Boolean),
    labels: labelsForThemes(themeList),
  };
}

export interface FilterOptions {
  minPopularity: number; // Lichess popularity runs from -100 to 100
  minPlays: number;
  maxRatingDeviation: number; // lower = the rating is better established
  perLabelBandCap: number; // max puzzles per label per 100-point rating band
  maxTotal: number;
}

export const DEFAULT_FILTER: FilterOptions = {
  minPopularity: 60,
  minPlays: 50,
  maxRatingDeviation: 100,
  perLabelBandCap: 250,
  maxTotal: 300_000,
};

/** Why a puzzle was left out (or "kept"). Quality reasons name the first check it failed. */
export type Decision =
  | "kept"
  | "storeFull"
  | "lowPopularity"
  | "fewPlays"
  | "unsettledRating"
  | "noLabel" // none of its themes maps to a Blindspot label
  | "phaseOnly" // only opening / middlegame / endgame, no specific motif
  | "bandFull"; // every label it trains already has enough puzzles at this rating

export function qualityFailure(p: PuzzleRow, o: FilterOptions = DEFAULT_FILTER): Decision | null {
  if (p.popularity < o.minPopularity) return "lowPopularity";
  if (p.nb_plays < o.minPlays) return "fewPlays";
  if (p.rating_deviation > o.maxRatingDeviation) return "unsettledRating";
  return null;
}

/** Decides, puzzle by puzzle, what goes into the store. Keeps running counts per label and rating band. */
export class PuzzleFilter {
  private buckets = new Map<string, number>();
  kept = 0;
  seen = 0;
  readonly perLabel = new Map<string, number>();
  readonly decisions = new Map<Decision, number>();

  constructor(private opts: FilterOptions = DEFAULT_FILTER) {}

  accept(p: PuzzleRow): boolean {
    return this.decide(p) === "kept";
  }

  decide(p: PuzzleRow): Decision {
    this.seen++;
    const d = this.judge(p);
    this.decisions.set(d, (this.decisions.get(d) ?? 0) + 1);
    return d;
  }

  private judge(p: PuzzleRow): Decision {
    const o = this.opts;
    if (this.kept >= o.maxTotal) return "storeFull";
    const quality = qualityFailure(p, o);
    if (quality) return quality;

    const qualifying = p.labels.filter((l) => QUALIFYING_LABELS.has(l));
    if (qualifying.length === 0) return p.labels.length === 0 ? "noLabel" : "phaseOnly";

    const band = Math.floor(p.rating / 100);
    const key = (label: string) => `${label}:${band}`;
    if (!qualifying.some((l) => (this.buckets.get(key(l)) ?? 0) < o.perLabelBandCap)) return "bandFull";

    for (const l of qualifying) this.buckets.set(key(l), (this.buckets.get(key(l)) ?? 0) + 1);
    for (const l of p.labels) this.perLabel.set(l, (this.perLabel.get(l) ?? 0) + 1);
    this.kept++;
    return "kept";
  }

  isFull(): boolean {
    return this.kept >= this.opts.maxTotal;
  }
}

// ---------------------------------------------------------------------------
// Report on what was left out, to judge whether the labels cover enough
// ---------------------------------------------------------------------------

const MATE_IN_N = ["mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5"];

/** Lichess themes we don't use yet, and how a label for each would pick puzzles. */
export const CANDIDATES: { name: string; matches: (themes: string[]) => boolean }[] = [
  { name: "Converting (advantage/crushing)", matches: (t) => t.includes("advantage") || t.includes("crushing") },
  { name: "Defending (equality)", matches: (t) => t.includes("equality") },
  { name: "Mate in 6+ (mate, no mateInN)", matches: (t) => t.includes("mate") && !t.some((x) => MATE_IN_N.includes(x)) },
  { name: "Zugzwang", matches: (t) => t.includes("zugzwang") },
  { name: "Kingside attack", matches: (t) => t.includes("kingsideAttack") },
  { name: "Queenside attack", matches: (t) => t.includes("queensideAttack") },
  { name: "En passant", matches: (t) => t.includes("enPassant") },
  { name: "Castling", matches: (t) => t.includes("castling") },
];

interface CandidateCount {
  /** Good-quality puzzles with this theme. */
  goodQuality: number;
  /** Of those, how many the current filter left out. */
  leftOut: number;
  /** Of those left out, how many a new label would add under the same per-band cap. */
  wouldAdd: number;
}

export class FilterReport {
  /** Themes on good-quality puzzles left out for having no usable label. */
  readonly unusedThemes = new Map<string, number>();
  readonly candidates = new Map<string, CandidateCount>(
    CANDIDATES.map((c) => [c.name, { goodQuality: 0, leftOut: 0, wouldAdd: 0 }]),
  );
  private candidateBuckets = new Map<string, number>();

  constructor(private opts: FilterOptions = DEFAULT_FILTER) {}

  /** Call for every puzzle, with the filter's decision about it. */
  record(p: PuzzleRow, decision: Decision) {
    if (qualityFailure(p, this.opts)) return; // only good-quality puzzles are interesting here

    if (decision === "noLabel" || decision === "phaseOnly") {
      for (const t of p.themes) this.unusedThemes.set(t, (this.unusedThemes.get(t) ?? 0) + 1);
    }

    const band = Math.floor(p.rating / 100);
    for (const c of CANDIDATES) {
      if (!c.matches(p.themes)) continue;
      const count = this.candidates.get(c.name)!;
      count.goodQuality++;
      if (decision === "kept") continue;
      count.leftOut++;
      const key = `${c.name}:${band}`;
      const inBand = this.candidateBuckets.get(key) ?? 0;
      if (inBand < this.opts.perLabelBandCap) {
        this.candidateBuckets.set(key, inBand + 1);
        count.wouldAdd++;
      }
    }
  }

  /** The most common unused themes, largest first. */
  topUnusedThemes(limit = 25): [string, number][] {
    return [...this.unusedThemes.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }
}
