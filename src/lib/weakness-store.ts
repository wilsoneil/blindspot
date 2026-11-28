// Loads analysed games and mistakes, rebuilds the weakness profiles and saves them.
// Server-only: used by the daily analysis job and by the settings page.

import { buildProfile, type Profile, type ProfileGame, type ProfileMistake } from "./analysis/profile";
import { backfillDates, historyEntries, trendOf, type Trend } from "./progress/weakness-trend";
import { puzzleScores, type PuzzleAttemptForScore } from "./analysis/puzzle-scores";
import type { Db } from "./db";
import { readAll } from "./read-all";
import { describeTimeControl, type Settings } from "./settings";
import { isFullySolved } from "./training/rating";

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
  labels: r.labels, puzzleRating: r.puzzle_rating, fullySolved: isFullySolved(r), attemptedAt: r.attempted_at,
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

  // Cached as promises, so the same count asked for twice at once is only read once.
  const puzzleCounts = new Map<string, Promise<number>>();
  const countPuzzles = (labels: string[]) => {
    const k = [...labels].sort().join("+");
    if (!puzzleCounts.has(k)) {
      puzzleCounts.set(k, (async () => {
        const { count, error } = await db.from("puzzles").select("id", { count: "exact", head: true }).contains("labels", labels);
        if (error) throw new Error(`Could not count puzzles: ${error.message}`);
        return count ?? 0;
      })());
    }
    return puzzleCounts.get(k)!;
  };

  const build = (data: { games: ProfileGame[]; mistakes: ProfileMistake[] }, review = false) =>
    buildProfile(data.games, data.mistakes, {
      halfLifeDays: settings.halfLifeDays, gamesWeightPct: settings.gamesWeightPct, now, countPuzzles,
      puzzleScores: fromPuzzles, review,
    });
  /** From games only (no puzzle results), as it stood at `at`: for the weakness history. */
  const buildFromGames = (data: { games: ProfileGame[]; mistakes: ProfileMistake[] }, at: Date) =>
    buildProfile(
      data.games.filter((g) => new Date(g.playedAt) <= at),
      data.mistakes.filter((m) => new Date(m.playedAt) <= at),
      { halfLifeDays: settings.halfLifeDays, gamesWeightPct: 100, now: at, countPuzzles },
    );
  return { byKey, build, buildFromGames };
}

/** Rebuilds every profile for a user from the stored analysis and puzzle results. Returns the profile keys written. */
export async function rebuildProfiles(
  db: Db, userId: string, settings: Settings, now = new Date(),
  /** Also save today's point of each weakness's history (the daily job; the first run fills in the past). */
  o: { history?: boolean } = {},
): Promise<string[]> {
  const { byKey, build, buildFromGames } = await loadProfileInputs(db, userId, settings, now);
  const written: string[] = [];
  for (const [key, data] of byKey) {
    const profile = await build(data);
    await saveProfile(db, userId, key, profile, now);
    written.push(key);
    if (o.history) await saveHistory(db, userId, key, data, buildFromGames, now);
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

const isMissingHistoryTable = (message: string) => /weakness_history/.test(message);

/**
 * Today's history point for each weakness, and, the first time (no rows yet), one a week back
 * to four weeks after the first game. Skipped with a note if migration 0007 isn't applied yet.
 */
async function saveHistory(
  db: Db, userId: string, profileKey: string, data: { games: ProfileGame[]; mistakes: ProfileMistake[] },
  buildFromGames: (data: { games: ProfileGame[]; mistakes: ProfileMistake[] }, at: Date) => Promise<Profile>, now: Date,
) {
  const { count, error } = await db.from("weakness_history").select("key", { count: "exact", head: true })
    .eq("user_id", userId).eq("profile_key", profileKey);
  if (error) {
    if (isMissingHistoryTable(error.message)) {
      console.log("Weakness history skipped: apply migration 0007 to keep it.");
      return;
    }
    throw new Error(`Could not read the weakness history: ${error.message}`);
  }
  const firstGame = Math.min(...data.games.map((g) => new Date(g.playedAt).getTime()));
  const dates = [...(count ? [] : backfillDates(firstGame, now.getTime()).map((t) => new Date(t))), now];
  if (!count && dates.length > 1) console.log(`  ${profileKey}: filling in ${dates.length - 1} weeks of weakness history`);

  let rows: Record<string, unknown>[] = [];
  const flush = async () => {
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e } = await db.from("weakness_history").upsert(rows.slice(i, i + 500));
      if (e) throw new Error(`Could not save the weakness history: ${e.message}`);
    }
    rows = [];
  };
  for (const at of dates) {
    const p = await buildFromGames(data, at);
    const takenOn = at.toISOString().slice(0, 10);
    for (const e of historyEntries(p)) {
      rows.push({
        user_id: userId, profile_key: profileKey, taken_on: takenOn, key: e.key,
        per_game: e.perGame, score: e.score, mistakes: e.mistakes, games: e.games,
      });
    }
    if (rows.length >= 2000) await flush();
  }
  await flush();
}

/** Each weakness's trend in games over the last 120 days, for the home page. Empty before migration 0007. */
export async function loadWeaknessTrends(
  db: Db, userId: string, profileKey: string, keys: string[], now = new Date(),
): Promise<Record<string, Trend>> {
  if (!keys.length) return {};
  const since = new Date(now.getTime() - 120 * 86_400_000).toISOString().slice(0, 10);
  const rows = await readAll<{ key: string; taken_on: string; per_game: number }>((from, to) =>
    db.from("weakness_history").select("key, taken_on, per_game")
      .eq("user_id", userId).eq("profile_key", profileKey).in("key", keys).gte("taken_on", since)
      .order("taken_on").range(from, to)).catch((e: Error) => {
    if (isMissingHistoryTable(e.message)) return [];
    throw e;
  });
  const out: Record<string, Trend> = {};
  for (const k of keys) {
    const t = trendOf(rows.filter((r) => r.key === k).map((r) => ({ t: new Date(`${r.taken_on}T00:00:00Z`).getTime(), perGame: r.per_game })), now.getTime());
    if (t) out[k] = t;
  }
  return out;
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
