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

/** Decides, puzzle by puzzle, what goes into the store. Keeps running counts per label and rating band. */
export class PuzzleFilter {
  private buckets = new Map<string, number>();
  kept = 0;
  seen = 0;
  readonly perLabel = new Map<string, number>();

  constructor(private opts: FilterOptions = DEFAULT_FILTER) {}

  accept(p: PuzzleRow): boolean {
    this.seen++;
    const o = this.opts;
    if (this.kept >= o.maxTotal) return false;
    if (p.popularity < o.minPopularity || p.nb_plays < o.minPlays || p.rating_deviation > o.maxRatingDeviation) return false;

    const qualifying = p.labels.filter((l) => QUALIFYING_LABELS.has(l));
    if (qualifying.length === 0) return false;

    const band = Math.floor(p.rating / 100);
    const key = (label: string) => `${label}:${band}`;
    if (!qualifying.some((l) => (this.buckets.get(key(l)) ?? 0) < o.perLabelBandCap)) return false;

    for (const l of qualifying) this.buckets.set(key(l), (this.buckets.get(key(l)) ?? 0) + 1);
    for (const l of p.labels) this.perLabel.set(l, (this.perLabel.get(l) ?? 0) + 1);
    this.kept++;
    return true;
  }

  isFull(): boolean {
    return this.kept >= this.opts.maxTotal;
  }
}
