// The top-weaknesses list on the home page.

import Link from "next/link";
import { describeKey } from "@/lib/analysis/profile";
import { weaknessFromKey } from "@/lib/training/sources";
import type { StoredProfile } from "@/lib/weakness-store";

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function WeaknessList({ profile, shown }: { profile: StoredProfile; shown: number }) {
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
          </li>
        ))}
      </ol>
      {top.some((w) => weaknessFromKey(w.key)) && (
        <div className="modes">
          <span className="small muted">All your top weaknesses, mixed:</span>
          <Link className="button" href={`/train/blindspot?tc=${encodeURIComponent(profile.profileKey)}`}>Blindspot</Link>
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
