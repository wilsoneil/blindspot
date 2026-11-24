import Link from "next/link";
import { getAppContext } from "@/lib/app-data";
import type { Db } from "@/lib/db";
import { describeTimeControl } from "@/lib/settings";
import { SetupNotice } from "./setup-notice";

async function loadStatus(db: Db, userId: string, focusTimeControl: string) {
  const [focusGames, allGames, lastGame, puzzles, ratings] = await Promise.all([
    db.from("games").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("time_control", focusTimeControl),
    db.from("games").select("id", { count: "exact", head: true }).eq("user_id", userId),
    db.from("games").select("played_at").eq("user_id", userId).order("played_at", { ascending: false }).limit(1),
    db.from("puzzles").select("id", { count: "estimated", head: true }),
    db.from("rating_snapshots").select("time_class, rating, taken_on").eq("user_id", userId)
      .order("taken_on", { ascending: false }).limit(8),
  ]);
  const latest = new Map<string, number>();
  for (const r of ratings.data ?? []) if (!latest.has(r.time_class)) latest.set(r.time_class, r.rating);
  return {
    focusGames: focusGames.count ?? 0,
    allGames: allGames.count ?? 0,
    lastGame: lastGame.data?.[0]?.played_at as string | undefined,
    puzzles: puzzles.count ?? 0,
    blitz: latest.get("blitz"),
    daily: latest.get("daily"),
  };
}

export default async function Home() {
  const ctx = await getAppContext();
  if (ctx.status !== "ready") return <SetupNotice ctx={ctx} />;

  const { settings } = ctx;
  const s = await loadStatus(ctx.db, ctx.userId, settings.focusTimeControl);
  const tc = describeTimeControl(settings.focusTimeControl);

  return (
    <>
      {!settings.chesscomUsername && (
        <section className="card notice">
          <h2>Welcome</h2>
          <p>Start by adding your chess.com username on the <Link href="/settings">Settings</Link> page.</p>
        </section>
      )}

      <section className="card">
        <h1>Top weaknesses <span className="pill">{tc}</span></h1>
        <p className="muted">
          Your weakness profile appears here once your games have been analysed. That arrives in Phase 2.
        </p>
      </section>

      <section className="card">
        <h2>Foundations</h2>
        <div className="stats">
          <div className="stat">
            <div className="stat-value">{s.focusGames.toLocaleString()}</div>
            <div className="stat-label">{tc} games imported</div>
          </div>
          <div className="stat">
            <div className="stat-value">{s.allGames.toLocaleString()}</div>
            <div className="stat-label">games in all time controls</div>
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
          {s.lastGame
            ? `Latest game: ${new Date(s.lastGame).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`
            : "No games imported yet."}
        </p>
      </section>
    </>
  );
}
