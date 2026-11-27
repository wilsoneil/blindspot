// The Blindspot rating with its week / month / all-time chart (SPEC.md -> "Progress and
// headline metrics"). Shown on the Settings page; the home page leads with the Blitz gap.

import type { Db } from "@/lib/db";
import { chartSeries } from "@/lib/progress/series";
import { MIN_RD, replay } from "@/lib/training/rating";
import { CompactTrend } from "./trend-chart";

const PAGE = 1000;

/** The Blindspot rating and its chart series, replayed from the rated first attempts (Lichess puzzles only). */
export async function loadRatingCard(db: Pick<Db, "from">, userId: string) {
  const rated: { puzzleRating: number; fullySolved: boolean; at: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("puzzle_attempts")
      .select("puzzle_rating, correct, solve_ms, target_ms, attempted_at")
      .eq("user_id", userId).eq("first_attempt", true).not("puzzle_id", "is", null)
      .order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read attempts for the rating: ${error.message}`);
    const rows = data as { puzzle_rating: number; correct: boolean; solve_ms: number; target_ms: number; attempted_at: string }[];
    for (const a of rows) {
      rated.push({ puzzleRating: a.puzzle_rating, fullySolved: a.correct && a.solve_ms <= a.target_ms, at: new Date(a.attempted_at).getTime() });
    }
    if (rows.length < PAGE) break;
  }
  const history = replay(rated);
  const points = history.map((h, i) => ({ t: rated[i].at, v: Math.round(h.rating) }));
  return { last: history.at(-1), count: history.length, series: chartSeries(points, Date.now()) };
}

export function RatingCard({ rating }: { rating: Awaited<ReturnType<typeof loadRatingCard>> }) {
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
        series={series} label="Blindspot rating"
        footnote="Your rating on puzzles from your weaknesses, solved within the target time. It sets how hard training puzzles are." />
    </section>
  );
}
