// Shared page body for the mixed modes, Rush and Survival (SPEC.md -> "Training modes").

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/app-data";
import { clientPuzzle } from "@/lib/training/client-puzzle";
import { puzzleLevel } from "@/lib/training/rating";
import { mixedWeaknesses, selectRunPuzzles, shuffled } from "@/lib/training/run";
import { describeProfileKey, loadProfiles, profileKeyForSetting } from "@/lib/weakness-store";
import { SetupNotice } from "../setup-notice";
import { Run } from "./run";

/** Rush always ends after this many failed puzzles (or when the clock runs out). */
export const RUSH_LIVES = 3;

const TEXT = {
  rush: (s: { rushMinutes: number }) =>
    `As many puzzles as you can in ${s.rushMinutes} minutes, getting harder as you go. A wrong move ends that puzzle; ${RUSH_LIVES} failed puzzles end the rush.`,
  survival: (s: { survivalLives: number }) =>
    `Puzzles keep coming, getting harder, until you've failed ${s.survivalLives} of them.`,
};

export async function MixedModePage({ mode, tc }: { mode: "rush" | "survival"; tc?: string }) {
  const ctx = await getAppContext();
  if (ctx.status === "signed-out") redirect("/login");
  if (ctx.status !== "ready") return <SetupNotice ctx={ctx} />;

  const profileKey = tc?.slice(0, 40) ?? profileKeyForSetting(ctx.settings.focusTimeControl);
  const profile = (await loadProfiles(ctx.db, ctx.userId)).find((p) => p.profileKey === profileKey);
  const weaknesses = shuffled(mixedWeaknesses(profile?.top ?? [], ctx.settings.weaknessesShown));
  const title = mode === "rush" ? "Rush" : "Survival";
  const back = <p className="small" style={{ marginBottom: 0 }}><Link href="/">Back to your weaknesses</Link></p>;

  if (weaknesses.length === 0) {
    return (
      <section className="card">
        <h1>{title}</h1>
        <p className="muted">None of your top weaknesses can be trained yet.</p>
        {back}
      </section>
    );
  }

  const level = await puzzleLevel(ctx.db, ctx.userId);
  const puzzles = await selectRunPuzzles(ctx.db, {
    userId: ctx.userId, weaknesses, level, fromChunk: 0, chunks: 2,
  });
  return (
    <section className="card">
      <h1>{title} <span className="pill">{describeProfileKey(profileKey)}</span></h1>
      <Run
        mode={mode}
        profileKey={profileKey}
        weaknessKeys={weaknesses.map((w) => w.key)}
        initial={puzzles.map((p) => clientPuzzle(p, ctx.settings, level))}
        rushMs={ctx.settings.rushMinutes * 60_000}
        lives={mode === "rush" ? RUSH_LIVES : ctx.settings.survivalLives}
        intro={`${TEXT[mode](ctx.settings)} Puzzles come from all your top weaknesses, mixed with earlier misses that are due for another look.`}
      />
      {back}
    </section>
  );
}
