import Link from "next/link";
import { redirect } from "next/navigation";
import { ANALYSIS_VERSION } from "@/lib/analysis/eval";
import { getAppContext } from "@/lib/app-data";
import type { Db } from "@/lib/db";
import { describeTimeControl, type Settings } from "@/lib/settings";
import { blitzGap, SMOOTHING_DAYS, type RatingSample } from "@/lib/progress/blitz-gap";
import { chartSeries } from "@/lib/progress/series";
import { MIN_RD, ratingHistory } from "@/lib/training/rating";
import { recentDrills } from "@/lib/training/stats";
import {
  ANALYSED_TIME_CLASSES, describeProfileKey, historyStart, loadProfiles, profileKeyForSetting,
} from "@/lib/weakness-store";
import { SetupNotice } from "./setup-notice";
import { TrendChart } from "./trend-chart";
import { formatDate, WeaknessList } from "./weakness-list";

async function loadStatus(db: Db, userId: string, settings: Settings) {
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

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getAppContext();
  if (ctx.status === "signed-out") redirect("/login");
  if (ctx.status !== "ready") return <SetupNotice ctx={ctx} />;

  const { settings } = ctx;
  const [s, profiles, params, drills, history, gap] = await Promise.all([
    loadStatus(ctx.db, ctx.userId, settings),
    loadProfiles(ctx.db, ctx.userId),
    searchParams,
    recentDrills(ctx.db, ctx.userId),
    loadRating(ctx.db, ctx.userId),
    loadBlitzGap(ctx.db, ctx.userId),
  ]);
  profiles.sort((a, b) => b.gamesAnalysed - a.gamesAnalysed);

  const focusKey = profileKeyForSetting(settings.focusTimeControl);
  const asked = typeof params.tc === "string" ? params.tc : null;
  const selectedKey = asked && profiles.some((p) => p.profileKey === asked) ? asked : focusKey;
  const profile = profiles.find((p) => p.profileKey === selectedKey);
  const total = s.analysed + s.waiting;

  return (
    <>
      <RatingCard rating={history} />
      {settings.chesscomUsername && <BlitzGapCard gap={gap} />}

      {!settings.chesscomUsername && (
        <section className="card notice">
          <h2>Welcome</h2>
          <p>Start by adding your chess.com username on the <Link href="/settings">Settings</Link> page.</p>
        </section>
      )}

      <section className="card">
        <h1>Top weaknesses <span className="pill">{describeProfileKey(selectedKey)}</span></h1>
        {profiles.length > 1 && (
          <nav className="filters" aria-label="Time control">
            {profiles.map((p) => (
              <Link
                key={p.profileKey}
                href={p.profileKey === focusKey ? "/" : `/?tc=${encodeURIComponent(p.profileKey)}`}
                className={p.profileKey === selectedKey ? "filter active" : "filter"}
                aria-current={p.profileKey === selectedKey ? "page" : undefined}
              >
                {describeProfileKey(p.profileKey)}
              </Link>
            ))}
          </nav>
        )}
        {profile && profile.top.length > 0 ? (
          <WeaknessList profile={profile} shown={settings.weaknessesShown} drills={drills} />
        ) : (
          <p className="muted" style={{ marginBottom: 0 }}>
            {s.analysed === 0
              ? "Your weakness profile appears here once your games have been analysed."
              : `No ${describeTimeControl(settings.focusTimeControl)} games with enough evidence yet. Try another time control above, or wait for more games.`}
          </p>
        )}
      </section>

      {s.waiting > 0 && (
        <section className="card">
          <h2>Analysis</h2>
          <div className="bar" aria-hidden="true">
            <div className="bar-fill" style={{ width: `${total ? (100 * s.analysed) / total : 0}%` }} />
          </div>
          <p className="small muted" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
            {s.analysed.toLocaleString()} of {total.toLocaleString()} blitz and daily games analysed.
            The rest are analysed by the daily job, or sooner by running &ldquo;Analyse games&rdquo; in GitHub Actions.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Your data</h2>
        <div className="stats">
          <div className="stat">
            <div className="stat-value">{s.allGames.toLocaleString()}</div>
            <div className="stat-label">games imported</div>
          </div>
          <div className="stat">
            <div className="stat-value">{s.analysed.toLocaleString()}</div>
            <div className="stat-label">games analysed</div>
          </div>
          <div className="stat">
            <div className="stat-value">{s.puzzles.toLocaleString()}</div>
            <div className="stat-label">puzzles in the store</div>
          </div>
          <div className="stat">
            <div className="stat-value">
              {s.blitz ?? "–"} <span className="muted">/</span> {s.daily ?? "–"}
            </div>
            <div className="stat-label">blitz / daily rating</div>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          {s.lastGame ? `Latest game: ${formatDate(s.lastGame)}.` : "No games imported yet."}
        </p>
      </section>
    </>
  );
}

/** The Blindspot rating with its chart series (SPEC.md -> "Progress and headline metrics"). */
async function loadRating(db: Db, userId: string) {
  const history = await ratingHistory(db, userId);
  const last = history.at(-1)?.rating;
  const points = history.map((h) => ({ t: new Date(h.at).getTime(), v: Math.round(h.rating.rating) }));
  return { last, count: history.length, series: chartSeries(points, Date.now()) };
}

/** The home page's headline number. */
function RatingCard({ rating }: { rating: Awaited<ReturnType<typeof loadRating>> }) {
  const { last, count, series } = rating;
  if (!last) {
    return (
      <section className="card">
        <div className="headline-label">Blindspot rating</div>
        <p className="small muted" style={{ margin: "0.25rem 0 0" }}>
          Your rating appears after your first puzzles in Drill, Rush or Survival.
        </p>
      </section>
    );
  }
  // Glicko-2 is unsure of a new rating; say so until it has settled a little.
  const provisional = last.rd > 2 * MIN_RD;
  return (
    <section className="card">
      <div className="headline-label">Blindspot rating</div>
      <div className="headline-value">
        {Math.round(last.rating)}{provisional && <span className="small muted" style={{ fontWeight: 400 }}> provisional</span>}
      </div>
      <TrendChart series={series} label="Blindspot rating" initial="month" />
      <p className="small muted" style={{ margin: "0.35rem 0 0" }}>
        From your first attempts at {count.toLocaleString()} puzzle{count === 1 ? "" : "s"}. It only rises for puzzles solved within the target time.
      </p>
    </section>
  );
}

const PAGE = 1000;

/** Blitz and daily ratings from every imported game and the daily snapshots, smoothed into the gap. */
async function loadBlitzGap(db: Db, userId: string) {
  const samples: RatingSample[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("games").select("played_at, time_class, user_rating")
      .eq("user_id", userId).in("time_class", ["blitz", "daily"]).not("user_rating", "is", null)
      .order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read game ratings: ${error.message}`);
    for (const g of data) samples.push({ timeClass: g.time_class, t: new Date(g.played_at).getTime(), rating: g.user_rating });
    if (data.length < PAGE) break;
  }
  const { data: snaps, error } = await db.from("rating_snapshots").select("taken_on, time_class, rating")
    .eq("user_id", userId).in("time_class", ["blitz", "daily"]);
  if (error) throw new Error(`Could not read rating snapshots: ${error.message}`);
  // A snapshot is the rating when the day's import ran: put it at the start of that day,
  // so games played later the same day come after it.
  for (const r of snaps) samples.push({ timeClass: r.time_class, t: new Date(`${r.taken_on}T00:00:00Z`).getTime(), rating: r.rating });

  const now = Date.now();
  const gap = blitzGap(samples, now);
  return gap && { ...gap, chart: chartSeries(gap.series, now) };
}

const TREND_WORDS = { falling: "and falling", rising: "and rising", steady: "and steady" } as const;

/** The Blitz gap, smaller beneath the rating (SPEC.md -> "Progress and headline metrics"). */
function BlitzGapCard({ gap }: { gap: Awaited<ReturnType<typeof loadBlitzGap>> }) {
  if (!gap) {
    return (
      <section className="card">
        <div className="headline-label">Blitz gap</div>
        <p className="small muted" style={{ margin: "0.25rem 0 0" }}>
          Appears once you have both a Daily and a Blitz rating on chess.com.
        </p>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="headline-label">Blitz gap</div>
      <div className="gap-value">
        {gap.gap} <span className={`small gap-trend ${gap.trend}`}>{TREND_WORDS[gap.trend]}</span>
      </div>
      <TrendChart series={gap.chart} label="Blitz gap" colour={2} goodWhen="down" initial="month" />
      <p className="small muted" style={{ margin: "0.35rem 0 0" }}>
        Daily {gap.daily.average} minus blitz {gap.blitz.average}, each a {SMOOTHING_DAYS}-day average.
        Latest: daily {gap.daily.latest}, blitz {gap.blitz.latest}.
      </p>
    </section>
  );
}

