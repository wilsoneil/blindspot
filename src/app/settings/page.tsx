import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/app-data";
import { loadStatus } from "@/lib/data-status";
import { describeTimeControl } from "@/lib/settings";
import { loadRatingCard, RatingCard } from "../rating-card";
import { SetupNotice } from "../setup-notice";
import { formatDate } from "../weakness-list";
import { SettingsForm, type TimeControlOption } from "./settings-form";

export const metadata: Metadata = { title: "Settings · Blindspot" };

export default async function SettingsPage() {
  const ctx = await getAppContext();
  if (ctx.status === "signed-out") redirect("/login");
  if (ctx.status !== "ready") {
    return (
      <>
        <h1>Settings</h1>
        <SetupNotice ctx={ctx} />
      </>
    );
  }

  const [status, rating] = await Promise.all([
    loadStatus(ctx.db, ctx.userId, ctx.settings), loadRatingCard(ctx.db, ctx.userId),
  ]);

  // Time controls offered = the ones actually played, plus the default and current choice.
  const { data } = await ctx.db.from("games").select("time_control").eq("user_id", ctx.userId).limit(20000);
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(row.time_control, (counts.get(row.time_control) ?? 0) + 1);
  for (const tc of ["300", ctx.settings.focusTimeControl]) if (!counts.has(tc)) counts.set(tc, 0);
  const timeControls: TimeControlOption[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, games]) => ({ value, label: `${describeTimeControl(value)}${games ? ` (${games} games)` : ""}` }));

  return (
    <>
      <h1>Settings</h1>
      <SettingsForm settings={ctx.settings} timeControls={timeControls} />

      <RatingCard rating={rating} />

      <section className="card">
        <h2>Your data</h2>
        <div className="stats">
          <div className="stat">
            <div className="stat-value">{status.allGames.toLocaleString()}</div>
            <div className="stat-label">games imported</div>
          </div>
          <div className="stat">
            <div className="stat-value">{status.analysed.toLocaleString()}</div>
            <div className="stat-label">games analysed</div>
          </div>
          <div className="stat">
            <div className="stat-value">{status.puzzles.toLocaleString()}</div>
            <div className="stat-label">puzzles in the store</div>
          </div>
          <div className="stat">
            <div className="stat-value">
              {status.blitz ?? "–"} <span className="muted">/</span> {status.daily ?? "–"}
            </div>
            <div className="stat-label">blitz / daily rating</div>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          {status.lastGame ? `Latest game: ${formatDate(status.lastGame)}.` : "No games imported yet."}
        </p>
      </section>
      <p className="small muted">
        <Link href="/settings/profile-check">Profile check</Link>: how the weakness rules behave on your games.
      </p>
    </>
  );
}
