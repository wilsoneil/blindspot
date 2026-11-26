// What has been imported and analysed so far: the analysis progress on the home page and the
// "Your data" card on the settings page.

import { ANALYSIS_VERSION } from "./analysis/eval";
import type { Db } from "./db";
import type { Settings } from "./settings";
import { ANALYSED_TIME_CLASSES, historyStart } from "./weakness-store";

export async function loadStatus(db: Db, userId: string, settings: Settings) {
  const start = historyStart(settings.historyMonths, new Date())?.toISOString() ?? "1970-01-01T00:00:00Z";
  const inWindow = () =>
    db.from("games").select("id", { count: "exact", head: true })
      .eq("user_id", userId).in("time_class", ANALYSED_TIME_CLASSES).gte("played_at", start);
  const [allGames, lastGame, puzzles, ratings, analysed, waiting] = await Promise.all([
    db.from("games").select("id", { count: "exact", head: true }).eq("user_id", userId),
    db.from("games").select("played_at").eq("user_id", userId).order("played_at", { ascending: false }).limit(1),
    db.from("puzzles").select("id", { count: "estimated", head: true }),
    db.from("rating_snapshots").select("time_class, rating, taken_on").eq("user_id", userId)
      .order("taken_on", { ascending: false }).limit(8),
    inWindow().not("analysed_at", "is", null).eq("analysis_version", ANALYSIS_VERSION),
    inWindow().or(`analysis_version.is.null,analysis_version.lt.${ANALYSIS_VERSION}`),
  ]);
  const latest = new Map<string, number>();
  for (const r of ratings.data ?? []) if (!latest.has(r.time_class)) latest.set(r.time_class, r.rating);
  return {
    allGames: allGames.count ?? 0,
    lastGame: lastGame.data?.[0]?.played_at as string | undefined,
    puzzles: puzzles.count ?? 0,
    blitz: latest.get("blitz"),
    daily: latest.get("daily"),
    analysed: analysed.count ?? 0,
    waiting: waiting.count ?? 0,
  };
}
