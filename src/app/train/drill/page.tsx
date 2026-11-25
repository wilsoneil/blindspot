// Drill: one chosen weakness, own pace, unlimited retries (SPEC.md -> "Training modes").

import Link from "next/link";
import { redirect } from "next/navigation";
import { describeKey } from "@/lib/analysis/profile";
import { getAppContext } from "@/lib/app-data";
import { clientPuzzle } from "@/lib/training/client-puzzle";
import { DEFAULT_LEVEL, selectPuzzles, trainingSource } from "@/lib/training/select";
import { describeProfileKey, profileKeyForSetting } from "@/lib/weakness-store";
import { SetupNotice } from "../../setup-notice";
import { Drill } from "./drill";

export default async function DrillPage({ searchParams }: PageProps<"/train/drill">) {
  const ctx = await getAppContext();
  if (ctx.status === "signed-out") redirect("/login");
  if (ctx.status !== "ready") return <SetupNotice ctx={ctx} />;

  const params = await searchParams;
  const weaknessKey = typeof params.w === "string" ? params.w.slice(0, 300) : "";
  const profileKey = typeof params.tc === "string" ? params.tc.slice(0, 40) : profileKeyForSetting(ctx.settings.focusTimeControl);
  const source = trainingSource(weaknessKey ? weaknessKey.split("+") : []);

  const back = <p className="small" style={{ marginBottom: 0 }}><Link href="/">Back to your weaknesses</Link></p>;
  if (source.kind !== "puzzles") {
    return (
      <section className="card">
        <h1>Drill</h1>
        <p className="muted">
          {source.kind === "ownGames"
            ? "This weakness is trained with positions from your own games, which arrive in a later step."
            : source.reason === "opening"
              ? "Opening weaknesses become trainable once openings are matched to Lichess puzzles (a later step)."
              : "Choose a weakness to drill from the home page."}
        </p>
        {back}
      </section>
    );
  }

  const puzzles = await selectPuzzles(ctx.db, { userId: ctx.userId, puzzleLabels: source.puzzleLabels, count: 5 });
  return (
    <section className="card">
      <h1>{describeKey(weaknessKey)} <span className="pill">Drill</span></h1>
      <p className="small muted">
        Puzzles chosen for this weakness from your {describeProfileKey(profileKey)} games. Take your time:
        wrong moves can be retried, but only a clean solve within the target time counts as solved.
      </p>
      {puzzles.length > 0 ? (
        <Drill
          weaknessKey={weaknessKey}
          profileKey={profileKey}
          initial={puzzles.map((p) => clientPuzzle(p, ctx.settings, DEFAULT_LEVEL))}
        />
      ) : (
        <p className="muted">You&rsquo;ve attempted every puzzle for this weakness. Impressive.</p>
      )}
      {back}
    </section>
  );
}
