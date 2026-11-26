// The top-weaknesses list on the home page.

import Link from "next/link";
import { describeKey } from "@/lib/analysis/profile";
import { weaknessFromKey } from "@/lib/training/sources";
import { MIN_THEME_ATTEMPTS, type ThemeRating } from "@/lib/progress/theme-ratings";
import type { Trend } from "@/lib/progress/weakness-trend";
import type { StoredProfile } from "@/lib/weakness-store";

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function WeaknessList({ profile, shown, themes = {}, trends = {} }: {
  profile: StoredProfile; shown: number;
  /** Rating (or share solved) per weakness, from puzzles: the leading indicator. */
  themes?: Record<string, ThemeRating>;
  /** Cost per game in real games over time: the lagging indicator. */
  trends?: Record<string, Trend>;
}) {
  const top = profile.top.slice(0, shown);
  return (
    <>
      <ol className="weaknesses">
        {top.map((w) => (
          <li key={w.key} className="weakness">
            <div className="weakness-head">
              {/* Named from the key, so a wording change shows without waiting for the next rebuild. */}
              <span className="weakness-name">{describeKey(w.key)}</span>
              {weaknessFromKey(w.key) && (
                <Link
                  className="drill-link"
                  href={`/train/drill?w=${encodeURIComponent(w.key)}&tc=${encodeURIComponent(profile.profileKey)}`}
                  aria-label={`Drill ${describeKey(w.key)}`}
                >
                  Drill
                </Link>
              )}
              <span className="weakness-score" aria-label={`Severity ${w.severity} out of 100`}>{w.severity}</span>
            </div>
            <div className="bar" aria-hidden="true">
              <div className="bar-fill" style={{ width: `${Math.max(w.severity, 2)}%` }} />
            </div>
            <RowStats theme={themes[w.key]} trend={trends[w.key]} />
          </li>
        ))}
      </ol>
      {top.some((w) => weaknessFromKey(w.key)) ? (
        <div className="modes">
          <Link className="button" href={`/train/rush?tc=${encodeURIComponent(profile.profileKey)}`}>Rush</Link>
          <Link className="button" href={`/train/survival?tc=${encodeURIComponent(profile.profileKey)}`}>Survival</Link>
        </div>
      ) : null}
      {top.length < shown && (
        <p className="small muted">
          Only {top.length} {top.length === 1 ? "area has" : "areas have"} enough evidence so far (mistakes in at least three games).
        </p>
      )}
    </>
  );
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

/** One line per weakness: "Puzzles 1642 ↑38 · Games 3.1% ↓" and a sparkline. */
function RowStats({ theme, trend }: { theme?: ThemeRating; trend?: Trend }) {
  if (!theme && !trend) return null;
  return (
    <div className="small muted row-stats">
      {theme?.kind === "rating" && (
        <span>
          Puzzles <strong className="stat-num">{theme.rating}</strong>
          {theme.change !== null && theme.change !== 0 && (
            <span className={theme.change > 0 ? "theme-up" : "theme-down"}> {theme.change > 0 ? "↑" : "↓"}{Math.abs(theme.change)}</span>
          )}
        </span>
      )}
      {theme?.kind === "few" && <span>Puzzles {theme.attempts}/{MIN_THEME_ATTEMPTS}</span>}
      {theme?.kind === "own" && (
        <span>Positions <strong className="stat-num">{Math.round((100 * theme.solved) / theme.attempts)}%</strong></span>
      )}
      {theme && trend && <span aria-hidden="true"> · </span>}
      {trend && (
        <span>
          Games <strong className="stat-num">{pct(trend.now)}</strong>
          {trend.direction === "falling" && <span className="theme-up" aria-label="down on a month ago"> ↓</span>}
          {trend.direction === "rising" && <span className="theme-down" aria-label="up on a month ago"> ↑</span>}
          {" "}<Sparkline points={trend.points.map((p) => p.v)} />
        </span>
      )}
    </div>
  );
}

/** A tiny line of the last few months, no axes. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const [w, h] = [48, 14];
  const [lo, hi] = [Math.min(...points), Math.max(...points)];
  const y = (v: number) => (hi > lo ? h - 1 - ((v - lo) / (hi - lo)) * (h - 2) : h / 2);
  const line = points.map((v, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={line} fill="none" stroke="var(--chart-2)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** "How to read this", pinned to the top right of the weaknesses box (its text opens below the title). */
export function HowToRead({ profile }: { profile: StoredProfile }) {
  return (
    <details className="how-to-read small muted">
      <summary>How to read this</summary>
      <ul>
        <li>
          <strong>The number and bar:</strong> how weak each area is compared with the rest of your game; 100 is your
          weakest. From {profile.gamesAnalysed.toLocaleString()} analysed games and {profile.mistakes.toLocaleString()} mistakes,
          updated {formatDate(profile.computedAt)}.
        </li>
        <li>
          <strong>Puzzles:</strong> your rating on puzzles with this theme (from {MIN_THEME_ATTEMPTS} puzzles), and its change
          over 30 days. <strong>Positions:</strong> the share of positions from your own games you solved in time.
        </li>
        <li>
          <strong>Games:</strong> the winning chance these mistakes lose you per game, recent games counting more. It comes
          from games only, so it falls as training carries over; the arrow compares it with a month ago. A mistake with
          several labels counts for each, so the figures don&rsquo;t add up to a total.
        </li>
        <li>
          <strong>Drill</strong> trains one weakness; <strong>Rush</strong> and <strong>Survival</strong> mix them all.
          Weaknesses Lichess puzzles can&rsquo;t train use positions from your own games.
        </li>
      </ul>
    </details>
  );
}
