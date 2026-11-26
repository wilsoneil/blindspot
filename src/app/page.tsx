import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/app-data";
import type { Db } from "@/lib/db";
import { describeTimeControl } from "@/lib/settings";
import { blitzGap, SMOOTHING_DAYS, type RatingSample } from "@/lib/progress/blitz-gap";
import { chartSeries } from "@/lib/progress/series";
import { themeRating, type ThemeAttempt, type ThemeRating } from "@/lib/progress/theme-ratings";
import { MIN_RD, ratingHistory } from "@/lib/training/rating";
import { loadStatus } from "@/lib/data-status";
import {
  describeProfileKey, loadProfiles, loadWeaknessTrends, profileKeyForSetting,
} from "@/lib/weakness-store";
import { SetupNotice } from "./setup-notice";
import { CompactTrend } from "./trend-chart";
import { WeaknessList } from "./weakness-list";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getAppContext();
  if (ctx.status === "signed-out") redirect("/login");
  if (ctx.status !== "ready") return <SetupNotice ctx={ctx} />;

  const { settings } = ctx;
  const [s, profiles, params, history, gap, themeAttempts] = await Promise.all([
    loadStatus(ctx.db, ctx.userId, settings),
    loadProfiles(ctx.db, ctx.userId),
    searchParams,
    loadRating(ctx.db, ctx.userId),
    loadBlitzGap(ctx.db, ctx.userId),
    loadThemeAttempts(ctx.db, ctx.userId),
  ]);
  profiles.sort((a, b) => b.gamesAnalysed - a.gamesAnalysed);

  const focusKey = profileKeyForSetting(settings.focusTimeControl);
  const asked = typeof params.tc === "string" ? params.tc : null;
  const selectedKey = asked && profiles.some((p) => p.profileKey === asked) ? asked : focusKey;
  const profile = profiles.find((p) => p.profileKey === selectedKey);
  const trends = profile
    ? await loadWeaknessTrends(ctx.db, ctx.userId, profile.profileKey, profile.top.map((w) => w.key))
    : {};
  const total = s.analysed + s.waiting;

  return (
    <>
      <RatingCard rating={history} />

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
          <WeaknessList profile={profile} shown={settings.weaknessesShown}
            themes={themeRatings(profile.top.map((w) => w.key), themeAttempts)} trends={trends} />
        ) : (
          <p className="muted" style={{ marginBottom: 0 }}>
            {s.analysed === 0
              ? "Your weakness profile appears here once your games have been analysed."
              : `No ${describeTimeControl(settings.focusTimeControl)} games with enough evidence yet. Try another time control above, or wait for more games.`}
          </p>
        )}
      </section>

      {settings.chesscomUsername && <BlitzGapCard gap={gap} />}

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
      <section className="card compact-card">
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
    <section className="card compact-card">
      <CompactTrend
        title={<>Blindspot rating <span className="muted">· {count.toLocaleString()} puzzle{count === 1 ? "" : "s"}</span></>}
        value={<>{Math.round(last.rating)}{provisional && <span className="small muted" style={{ fontWeight: 400 }}> provisional</span>}</>}
        series={series} label="Blindspot rating" />
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

/** The Blitz gap, below the top weaknesses (SPEC.md -> "Progress and headline metrics"). */
function BlitzGapCard({ gap }: { gap: Awaited<ReturnType<typeof loadBlitzGap>> }) {
  if (!gap) {
    return (
      <section className="card compact-card">
        <div className="headline-label">Blitz gap</div>
        <p className="small muted" style={{ margin: "0.25rem 0 0" }}>
          Appears once you have both a Daily and a Blitz rating on chess.com.
        </p>
      </section>
    );
  }
  return (
    <section className="card compact-card">
      <CompactTrend
        title="Blitz gap"
        value={gap.gap < 0 ? `−${-gap.gap}` : gap.gap}
        footnote={<>Daily {gap.daily.average} − Blitz {gap.blitz.average} ({SMOOTHING_DAYS}-day averages)</>}
        series={gap.chart} label="Blitz gap" colour={2} goodWhen="down" />
    </section>
  );
}

/** Every first attempt, oldest first, for the rating per weakness theme. */
async function loadThemeAttempts(db: Db, userId: string) {
  const attempts: ThemeAttempt[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("puzzle_attempts")
      .select("labels, puzzle_rating, correct, solve_ms, target_ms, attempted_at")
      .eq("user_id", userId).eq("first_attempt", true).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read attempts for theme ratings: ${error.message}`);
    for (const a of data) {
      attempts.push({
        labels: a.labels, puzzleRating: a.puzzle_rating, fullySolved: a.correct && a.solve_ms <= a.target_ms,
        at: new Date(a.attempted_at).getTime(),
      });
    }
    if (data.length < PAGE) break;
  }
  return { attempts, now: Date.now() };
}

function themeRatings(keys: string[], t: Awaited<ReturnType<typeof loadThemeAttempts>>): Record<string, ThemeRating> {
  const out: Record<string, ThemeRating> = {};
  for (const k of keys) {
    const r = themeRating(k, t.attempts, t.now);
    if (r) out[k] = r;
  }
  return out;
}

