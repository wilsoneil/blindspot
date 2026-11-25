// Blindspot mode: all the top weaknesses, shuffled and unlabelled, plus past failures and
// slow solves due for review (SPEC.md -> "Training modes"). Own pace, as Drill.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/app-data";
import { selectBlindspot } from "@/lib/training/blindspot";
import { clientPuzzle } from "@/lib/training/client-puzzle";
import { puzzleLevel } from "@/lib/training/rating";
import { mixedWeaknesses } from "@/lib/training/run";
import { describeProfileKey, loadProfiles, profileKeyForSetting } from "@/lib/weakness-store";
import { SetupNotice } from "../../setup-notice";
import { Drill } from "../drill/drill";

export default async function BlindspotPage({ searchParams }: PageProps<"/train/blindspot">) {
  const ctx = await getAppContext();
  if (ctx.status === "signed-out") redirect("/login");
  if (ctx.status !== "ready") return <SetupNotice ctx={ctx} />;

  const { tc } = await searchParams;
  const profileKey = typeof tc === "string" ? tc.slice(0, 40) : profileKeyForSetting(ctx.settings.focusTimeControl);
  const profile = (await loadProfiles(ctx.db, ctx.userId)).find((p) => p.profileKey === profileKey);
  const weaknesses = mixedWeaknesses(profile?.top ?? [], ctx.settings.weaknessesShown);
  const level = await puzzleLevel(ctx.db, ctx.userId);
  const puzzles = await selectBlindspot(ctx.db, {
    userId: ctx.userId, weaknesses: weaknesses.map((w) => w.puzzleLabels), level, count: 6,
  });

  return (
    <section className="card">
      <h1>Blindspot <span className="pill">{describeProfileKey(profileKey)}</span></h1>
      <p className="small muted">
        Puzzles from all your top weaknesses, without saying which, plus earlier misses that are due for
        another look. Take your time: wrong moves can be retried.
      </p>
      {puzzles.length > 0 ? (
        <Drill
          mode="blindspot"
          weaknessKeys={weaknesses.map((w) => w.key)}
          profileKey={profileKey}
          initial={puzzles.map((p) => clientPuzzle(p, ctx.settings, level))}
          engineDefault={ctx.settings.engineOnBoard}
        />
      ) : (
        <p className="muted">
          {weaknesses.length === 0
            ? "None of your top weaknesses can be trained with Lichess puzzles yet."
            : "No puzzles available right now."}
        </p>
      )}
      <p className="small" style={{ marginBottom: 0 }}><Link href="/">Back to your weaknesses</Link></p>
    </section>
  );
}
