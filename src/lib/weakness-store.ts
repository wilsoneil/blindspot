// Loads analysed games and mistakes, rebuilds the weakness profiles and saves them.
// Server-only: used by the daily analysis job and by the settings page.

import { buildProfile, type Profile, type ProfileGame, type ProfileMistake } from "./analysis/profile";
import { puzzleScores, type PuzzleAttemptForScore } from "./analysis/puzzle-scores";
import type { Db } from "./db";
import { describeTimeControl, type Settings } from "./settings";

/** Time classes the analysis covers: blitz for the main profile, daily for the secondary one (SPEC.md). */
export const ANALYSED_TIME_CLASSES = ["blitz", "daily"];

/** Which profile a game belongs to: its time control, with all daily games pooled. */
export function profileKey(timeClass: string, timeControl: string): string {
  return timeClass === "daily" || timeControl.includes("/") ? "daily" : timeControl;
}

/** The profile for a time-control setting ("1/86400" -> "daily"). */
export function profileKeyForSetting(timeControl: string): string {
  return timeControl.includes("/") ? "daily" : timeControl;
}

/** "300" -> "5 min", "daily" -> "Daily". */
export function describeProfileKey(key: string): string {
  return key === "daily" ? "Daily" : describeTimeControl(key);
}

/** Start of the analysis history window, or null for all games. */
export function historyStart(months: number | null, now: Date): Date | null {
  if (months === null) return null;
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

const PAGE = 1000;

/** Reads every row of a query, a page at a time (the API returns at most 1,000 rows per request). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

interface GameRow {
  id: number;
  played_at: string;
  time_class: string;
  time_control: string;
  colour: "white" | "black";
  situations: string[] | null;
  opening_family: string | null;
  opening_variation: string | null;
}

interface MistakeRow {
  game_id: number;
  played_at: string;
  win_chance_drop: number;
  phase: string;
  labels: string[];
}

interface AttemptRow {
  labels: string[];
  puzzle_rating: number;
  correct: boolean;
  solve_ms: number;
  target_ms: number;
  attempted_at: string;
}

const toScored = (r: AttemptRow): PuzzleAttemptForScore => ({
  labels: r.labels, puzzleRating: r.puzzle_rating, fullySolved: r.correct && r.solve_ms <= r.target_ms, attemptedAt: r.attempted_at,
});

/** Everything a profile is built from: analysed games and mistakes per profile key, and puzzle results. */
async function loadProfileInputs(db: Db, userId: string, settings: Settings, now: Date) {
  const start = historyStart(settings.historyMonths, now)?.toISOString() ?? "1970-01-01T00:00:00Z";

  const games = await readAll<GameRow>((from, to) =>
    db.from("games")
      .select("id, played_at, time_class, time_control, colour, situations, opening_family, opening_variation")
      .eq("user_id", userId).in("time_class", ANALYSED_TIME_CLASSES).not("analysed_at", "is", null)
      .gte("played_at", start).order("id").range(from, to));
  const mistakes = await readAll<MistakeRow>((from, to) =>
    db.from("mistakes")
      .select("game_id, played_at, win_chance_drop, phase, labels")
      .eq("user_id", userId).in("time_class", ANALYSED_TIME_CLASSES)
      .gte("played_at", start).order("id").range(from, to));

  const byKey = new Map<string, { games: ProfileGame[]; mistakes: ProfileMistake[] }>();
  const keyOfGame = new Map<number, string>();
  for (const g of games) {
    const key = profileKey(g.time_class, g.time_control);
    keyOfGame.set(g.id, key);
    const bucket = byKey.get(key) ?? byKey.set(key, { games: [], mistakes: [] }).get(key)!;
    bucket.games.push({
      id: g.id, playedAt: g.played_at, colour: g.colour, situations: g.situations ?? [],
      opening: { family: g.opening_family ?? "?", variation: g.opening_variation ?? "?" },
    });
  }
  for (const m of mistakes) {
    const key = keyOfGame.get(m.game_id);
    if (!key) continue;
    byKey.get(key)!.mistakes.push({
      gameId: m.game_id, playedAt: m.played_at, drop: m.win_chance_drop, phase: m.phase, labels: m.labels,
    });
  }

  // Puzzle results (Phase 3): the same scores for every time control, since puzzles have none.
  const attempts = await readAll<AttemptRow>((from, to) =>
    db.from("puzzle_attempts")
      .select("labels, puzzle_rating, correct, solve_ms, target_ms, attempted_at")
      .eq("user_id", userId).eq("first_attempt", true).not("puzzle_id", "is", null)
      .order("id").range(from, to));
  const fromPuzzles = puzzleScores(attempts.map(toScored), { halfLifeDays: settings.halfLifeDays, now });

  const puzzleCounts = new Map<string, number>();
  const countPuzzles = async (labels: string[]) => {
    const k = [...labels].sort().join("+");
    if (!puzzleCounts.has(k)) {
      const { count, error } = await db.from("puzzles").select("id", { count: "exact", head: true }).contains("labels", labels);
      if (error) throw new Error(`Could not count puzzles: ${error.message}`);
      puzzleCounts.set(k, count ?? 0);
    }
    return puzzleCounts.get(k)!;
  };

  const build = (data: { games: ProfileGame[]; mistakes: ProfileMistake[] }, review = false) =>
    buildProfile(data.games, data.mistakes, {
      halfLifeDays: settings.halfLifeDays, gamesWeightPct: settings.gamesWeightPct, now, countPuzzles,
      puzzleScores: fromPuzzles, review,
    });
  return { byKey, build };
}

/** Rebuilds every profile for a user from the stored analysis and puzzle results. Returns the profile keys written. */
export async function rebuildProfiles(db: Db, userId: string, settings: Settings, now = new Date()): Promise<string[]> {
  const { byKey, build } = await loadProfileInputs(db, userId, settings, now);
  const written: string[] = [];
  for (const [key, data] of byKey) {
    const profile = await build(data);
    await saveProfile(db, userId, key, profile, now);
    written.push(key);
  }

  // Remove profiles that no longer have any games (e.g. after shortening the history window).
  const { data: existing, error } = await db.from("weakness_profiles").select("profile_key").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const stale = existing.map((r) => r.profile_key as string).filter((k) => !byKey.has(k));
  if (stale.length) {
    const { error: delErr } = await db.from("weakness_profiles").delete().eq("user_id", userId).in("profile_key", stale);
    if (delErr) throw new Error(delErr.message);
  }
  return written;
}

/**
 * One profile built fresh with its review (why each pair was or wasn't used, how each family
 * fares), for the profile check page. Read-only: nothing is saved. Null if it has no games.
 */
export async function reviewProfile(
  db: Db, userId: string, settings: Settings, profileKey: string, now = new Date(),
): Promise<Profile | null> {
  const { byKey, build } = await loadProfileInputs(db, userId, settings, now);
  const data = byKey.get(profileKey);
  return data ? build(data, true) : null;
}

async function saveProfile(db: Db, userId: string, key: string, p: Profile, now: Date) {
  const { error } = await db.from("weakness_profiles").upsert({
    user_id: userId, profile_key: key, computed_at: now.toISOString(),
    games_analysed: p.gamesAnalysed, mistakes: p.mistakes, top: p.top, entries: p.all,
  });
  if (error) throw new Error(`Could not save the weakness profile: ${error.message}`);
}

export interface StoredProfile {
  profileKey: string;
  computedAt: string;
  gamesAnalysed: number;
  mistakes: number;
  top: Profile["top"];
}

/** All of a user's profiles (without the full category list). */
export async function loadProfiles(db: Db, userId: string): Promise<StoredProfile[]> {
  const { data, error } = await db.from("weakness_profiles")
    .select("profile_key, computed_at, games_analysed, mistakes, top").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return data.map((r) => ({
    profileKey: r.profile_key, computedAt: r.computed_at, gamesAnalysed: r.games_analysed,
    mistakes: r.mistakes, top: r.top,
  }));
}
