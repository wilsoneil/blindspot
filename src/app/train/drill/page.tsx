// Drill: one chosen weakness, own pace, unlimited retries (SPEC.md -> "Training modes").

import Link from "next/link";
import { redirect } from "next/navigation";
import { describeKey } from "@/lib/analysis/profile";
import { getAppContext } from "@/lib/app-data";
import { clientPuzzle } from "@/lib/training/client-puzzle";
import { puzzleLevel } from "@/lib/training/rating";
import { attemptedPuzzleIds, trainingSource } from "@/lib/training/select";
import { selectFor, weaknessFromKey } from "@/lib/training/sources";
import { profileKeyForSetting } from "@/lib/weakness-store";
import { SetupNotice } from "../../setup-notice";
import { Drill } from "./drill";

export default async function DrillPage({ searchParams }: PageProps<"/train/drill">) {
  const ctx = await getAppContext();
  if (ctx.status === "signed-out") redirect("/login");
  if (ctx.status !== "ready") return <SetupNotice ctx={ctx} />;

  const params = await searchParams;
  const weaknessKey = typeof params.w === "string" ? params.w.slice(0, 300) : "";
  const profileKey = typeof params.tc === "string" ? params.tc.slice(0, 40) : profileKeyForSetting(ctx.settings.focusTimeControl);
  const weakness = weaknessKey ? weaknessFromKey(weaknessKey) : null;

  const back = <p className="small" style={{ marginBottom: 0 }}><Link href="/">Back to your weaknesses</Link></p>;
  if (!weakness) {
    const source = trainingSource(weaknessKey ? weaknessKey.split("+") : []);
    return (
      <section className="card">
        <h1>Drill</h1>
        <p className="muted">
          {source.kind === "notYet" && source.reason === "opening"
            ? "This opening group can't be matched to Lichess puzzles (Offbeat openings pool too many different ones)."
            : "Choose a weakness to drill from the home page."}
        </p>
        {back}
      </section>
    );
  }

  // The Blindspot rating and the puzzles already seen, read together.
  const [level, attempted] = await Promise.all([puzzleLevel(ctx.db, ctx.userId), attemptedPuzzleIds(ctx.db, ctx.userId)]);
  const puzzles = await selectFor(ctx.db, weakness, { userId: ctx.userId, count: 5, level, attempted });
  const own = weakness.kind === "ownGames";
  return (
    <section className="card">
      <h1>{describeKey(weaknessKey)} <span className="pill">Drill</span></h1>
      {puzzles.length > 0 ? (
        <Drill
          weaknessKey={weaknessKey}
          profileKey={profileKey}
          initial={puzzles.map((p) => clientPuzzle(p, ctx.settings, level))}
          engineDefault={ctx.settings.engineOnBoard}
        />
      ) : (
        <p className="muted">
          {own
            ? "No positions ready for this weakness yet. They're worked out by the daily analysis job, or you've trained them all."
            : "You've attempted every puzzle for this weakness. Impressive."}
        </p>
      )}
      {back}
    </section>
  );
}
