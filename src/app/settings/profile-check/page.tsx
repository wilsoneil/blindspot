// Profile check (Phase 3, step 12): how the profile rules behave on the user's real data, so
// the pair rules and the family scoring can be reviewed without the data leaving the app.
// Read-only: builds the profile fresh and shows why each pair was or wasn't used.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/app-data";
import {
  MAX_PAIRS, MIN_GAMES, PAIR_MIN_GAMES, PAIR_MIN_LIFT, PAIR_MIN_PUZZLES, type PairOutcome,
} from "@/lib/analysis/profile";
import { describeProfileKey, profileKeyForSetting, reviewProfile } from "@/lib/weakness-store";
import { SetupNotice } from "../../setup-notice";

export const metadata: Metadata = { title: "Profile check · Blindspot" };

const FAMILY: Record<string, string> = {
  "tactic:missed": "Tactics (missed)",
  "tactic:allowed": "Tactics (allowed)",
  "mate:missed": "Mates (missed)",
  "mate:allowed": "Mates (allowed)",
  phase: "Game phases",
  endgame: "Endgame types",
  moveType: "Move types",
  positionState: "Position states",
  opening: "Openings",
};

const OUTCOME: Record<PairOutcome, string> = {
  shown: "Shown in the top list",
  parentNotInTop: "Broader label not near the top",
  notClearlyWorse: `Not clearly worse (under ${PAIR_MIN_LIFT}×)`,
  fewPositions: `Under ${PAIR_MIN_PUZZLES} puzzles / positions`,
  anotherPairBetter: "Another pair scored higher",
  pairLimit: `Already ${MAX_PAIRS} stronger pairs`,
  outOfTop: "Passed, but not high enough",
};

export default async function ProfileCheckPage({ searchParams }: PageProps<"/settings/profile-check">) {
  const ctx = await getAppContext();
  if (ctx.status === "signed-out") redirect("/login");
  if (ctx.status !== "ready") return <SetupNotice ctx={ctx} />;

  const params = await searchParams;
  const key = typeof params.tc === "string" ? params.tc : profileKeyForSetting(ctx.settings.focusTimeControl);
  const profile = await reviewProfile(ctx.db, ctx.userId, ctx.settings, key);
  if (!profile?.review) {
    return (
      <section className="card">
        <h1>Profile check</h1>
        <p className="muted">No analysed games for {describeProfileKey(key)} yet.</p>
      </section>
    );
  }
  const { pairs, families } = profile.review;
  const positional = pairs.filter((p) => p.positional);
  const onlyPositions = positional.filter((p) => p.outcome === "fewPositions");
  const top5 = profile.top.slice(0, 5);
  const tactical = families.filter((f) => /^(tactic|mate):/.test(f.family)).reduce((n, f) => n + f.inTop5, 0);

  return (
    <>
      <section className="card">
        <h1>Profile check <span className="pill">{describeProfileKey(key)}</span></h1>
        <p className="small muted">
          Built fresh from {profile.gamesAnalysed.toLocaleString()} games and {profile.mistakes.toLocaleString()} mistakes,
          to review the profile rules. Nothing here is saved. <Link href="/settings">Back to settings</Link>
        </p>
        <div className="stats">
          <div className="stat">
            <div className="stat-value">{tactical} / {top5.length}</div>
            <div className="stat-label">of the top five are tactics or mates</div>
          </div>
          <div className="stat">
            <div className="stat-value">{onlyPositions.length} / {positional.length}</div>
            <div className="stat-label">positional pairs stopped only by the {PAIR_MIN_PUZZLES} rule</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Families</h2>
        <p className="small muted">
          Each category is scored against its own family (1 = your average for the family), so a family with many
          categories can reach higher scores. &ldquo;Enough evidence&rdquo; = mistakes in at least {MIN_GAMES} games.
        </p>
        <div className="table-wrap">
          <table className="check-table">
            <thead>
              <tr><th>Family</th><th>Categories</th><th>Enough evidence</th><th>Top 5</th><th>Top 8</th><th>Highest score</th></tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.family}>
                  <td>{FAMILY[f.family] ?? f.family}</td>
                  <td>{f.labels}</td>
                  <td>{f.eligible}</td>
                  <td>{f.inTop5}</td>
                  <td>{f.inTop8}</td>
                  <td>{f.eligible ? f.highest.toFixed(2) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Pairs</h2>
        <p className="small muted">
          Every pair with mistakes in at least {PAIR_MIN_GAMES} games, highest score first, with the first rule it
          failed. A positional pair (one label with no Lichess theme) counts your own mistakes as its positions.
        </p>
        {pairs.length === 0 ? (
          <p className="muted">No pair has mistakes in {PAIR_MIN_GAMES} games yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="check-table">
              <thead>
                <tr><th>Pair</th><th>Games</th><th>Lift</th><th>Score</th><th>Puzzles / positions</th><th>Outcome</th></tr>
              </thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={p.key}>
                    <td>{p.name}{p.positional && <> <span className="pill">own games</span></>}</td>
                    <td>{p.games}</td>
                    <td>{p.lift.toFixed(2)}</td>
                    <td>{p.score.toFixed(2)}</td>
                    <td>{p.positions.toLocaleString()}</td>
                    <td>{OUTCOME[p.outcome]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
