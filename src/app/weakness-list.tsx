// The top-weaknesses list on the home page.

import Link from "next/link";
import { describeKey } from "@/lib/analysis/profile";
import { weaknessFromKey } from "@/lib/training/sources";
import { MIN_THEME_ATTEMPTS, type ThemeRating } from "@/lib/progress/theme-ratings";
import type { DrillStat } from "@/lib/training/stats";
import type { StoredProfile } from "@/lib/weakness-store";

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function WeaknessList({ profile, shown, drills = {}, themes = {} }: {
  profile: StoredProfile; shown: number; drills?: Record<string, DrillStat>;
  /** Rating (or share solved) per weakness, from puzzles: the leading indicator. */
  themes?: Record<string, ThemeRating>;
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
            <div className="small muted">
              {w.mistakes} mistake{w.mistakes === 1 ? "" : "s"} in {w.games} game{w.games === 1 ? "" : "s"}
            </div>
            {themes[w.key] && <ThemeLine r={themes[w.key]} />}
            {drills[w.key] && (
              <div className="small weakness-training">
                ▶ {drills[w.key].attempted} puzzle{drills[w.key].attempted === 1 ? "" : "s"} drilled this week
                {" · "}{Math.round((100 * drills[w.key].solved) / drills[w.key].attempted)}% solved
              </div>
            )}
          </li>
        ))}
      </ol>
      {top.some((w) => weaknessFromKey(w.key)) && (
        <div className="modes">
          <span className="small muted">All weaknesses, mixed:</span>
          <Link className="button" href={`/train/rush?tc=${encodeURIComponent(profile.profileKey)}`}>Rush</Link>
          <Link className="button" href={`/train/survival?tc=${encodeURIComponent(profile.profileKey)}`}>Survival</Link>
        </div>
      )}
      {top.length < shown && (
        <p className="small muted">
          Only {top.length} {top.length === 1 ? "area has" : "areas have"} enough evidence so far (mistakes in at least three games).
        </p>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        From {profile.gamesAnalysed.toLocaleString()} analysed games and {profile.mistakes.toLocaleString()} mistakes;
        updated {formatDate(profile.computedAt)}. Severity is relative: 100 is your weakest area.
        Tap Drill to train one. Weaknesses Lichess puzzles can&rsquo;t train use positions from your own games.
      </p>
    </>
  );
}

/** "Puzzle rating 1640 (+35 in 30 days)", or the share solved for own-game positions. */
function ThemeLine({ r }: { r: ThemeRating }) {
  if (r.kind === "own") {
    return (
      <div className="small muted">
        Own positions: {Math.round((100 * r.solved) / r.attempts)}% of {r.attempts} solved in time
      </div>
    );
  }
  if (r.kind === "few") {
    return (
      <div className="small muted">
        Puzzle rating after {MIN_THEME_ATTEMPTS} puzzles ({r.attempts} so far)
      </div>
    );
  }
  return (
    <div className="small muted">
      Puzzle rating <strong className="theme-rating">{r.rating}</strong>
      {r.change !== null && Math.round(r.change) !== 0 && (
        <span className={r.change > 0 ? "theme-up" : "theme-down"}> {r.change > 0 ? "+" : "−"}{Math.abs(r.change)} in 30 days</span>
      )}
      {" "}· {r.attempts} puzzles
    </div>
  );
}

