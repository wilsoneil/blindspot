// Profile check (Phase 3, step 12): how the profile rules behave on the user's real data, so
// the pair rules and the family scoring can be reviewed without the data leaving the app.
// Read-only: builds the profile fresh and shows why each pair was or wasn't used.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/app-data";
import {
  MAX_PAIRS, MIN_GAMES, PAIR_MIN_GAMES, PAIR_MIN_LIFT, PAIR_MIN_OWN_POSITIONS, PAIR_MIN_PUZZLES, type PairCheck, type PairOutcome,
} from "@/lib/analysis/profile";
import { describeProfileKey, profileKeyForSetting, reviewProfile } from "@/lib/weakness-store";
import {
  expectedSolved, fitCalibration, loadTrainingHistory, MIN_CALIBRATION_ATTEMPTS, positionRating, type PositionAttempt,
} from "@/lib/training/position-rating";
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
  fewPositions: `Under ${PAIR_MIN_PUZZLES} puzzles / ${PAIR_MIN_OWN_POSITIONS} own positions`,
  anotherPairBetter: "Another pair scored higher",
  pairLimit: `Already ${MAX_PAIRS} stronger pairs`,
  outOfTop: "Passed, but not high enough",
};

/** How own positions are rated: the fixed rule against the one fitted to the user's results. */
function PositionRatings({ positions, level }: { positions: PositionAttempt[]; level: number }) {
  const calibration = fitCalibration(positions);
  const solved = positions.filter((p) => p.fullySolved).length;
  const pct = (x: number) => `${Math.round(100 * x)}%`;
  return (
    <section className="card">
      <h2>Own-position ratings</h2>
      <p className="small muted">
        Positions from your games get a stand-in rating from how subtle the best move is. Until there
        are {MIN_CALIBRATION_ATTEMPTS} first attempts at them, it runs from 400 below your Blindspot rating (obvious) to
        400 above (subtle). After that, it is fitted to how often you solve them.
      </p>
      <p className="small">
        {positions.length.toLocaleString()} attempts counted{positions.length > 0 && <>, {pct(solved / positions.length)} solved in time</>}.{" "}
        {calibration ? "Using the fitted rule." : `Using the fixed rule (${MIN_CALIBRATION_ATTEMPTS - positions.length} more needed).`}
      </p>
      {positions.length > 0 && (
        <div className="table-wrap">
          <table className="check-table">
            <thead>
              <tr><th>Subtlety</th><th>Fixed rule</th><th>Fitted</th></tr>
            </thead>
            <tbody>
              {[0, 0.25, 0.5, 0.75, 1].map((s) => (
                <tr key={s}>
                  <td>{s}</td>
                  <td>{positionRating(level, s, null)}</td>
                  <td>{calibration ? positionRating(level, s, calibration) : "–"}</td>
                </tr>
              ))}
              <tr>
                <td>Expected solved</td>
                <td>{pct(expectedSolved(positions, null))}</td>
                <td>{calibration ? pct(expectedSolved(positions, calibration)) : "–"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const OUTCOME_ORDER: PairOutcome[] = [
  "shown", "outOfTop", "pairLimit", "anotherPairBetter", "fewPositions", "notClearlyWorse", "parentNotInTop",
];

function PairTable({ pairs, empty, outcome = false }: { pairs: PairCheck[]; empty: string; outcome?: boolean }) {
  if (pairs.length === 0) return <p className="small muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="check-table">
        <thead>
          <tr><th>Pair</th><th>Games</th><th>Lift</th><th>Score</th><th>Positions</th>{outcome && <th>Outcome</th>}</tr>
        </thead>
        <tbody>
          {pairs.map((p) => (
            <tr key={p.key}>
              <td>{p.name}{p.positional && <> <span className="pill">own</span></>}</td>
              <td>{p.games}</td>
              <td>{p.lift.toFixed(2)}</td>
              <td>{p.score.toFixed(2)}</td>
              <td>{p.positions.toLocaleString()}</td>
              {outcome && <td>{OUTCOME[p.outcome]}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ProfileCheckPage({ searchParams }: PageProps<"/settings/profile-check">) {
  const ctx = await getAppContext();
  if (ctx.status === "signed-out") redirect("/login");
  if (ctx.status !== "ready") return <SetupNotice ctx={ctx} />;

  const params = await searchParams;
  const key = typeof params.tc === "string" ? params.tc : profileKeyForSetting(ctx.settings.focusTimeControl);
  const [profile, history] = await Promise.all([
    reviewProfile(ctx.db, ctx.userId, ctx.settings, key), loadTrainingHistory(ctx.db, ctx.userId),
  ]);
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
            <div className="stat-label">own-position pairs stopped only by having too few positions</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Families</h2>
        <p className="small muted">
          Each category is scored against its own family (1 = your average for the family), so a family with many
          categories can reach higher scores. Evidence: categories with mistakes in at least {MIN_GAMES} games.
          Max: the highest score.
        </p>
        <div className="table-wrap">
          <table className="check-table">
            <thead>
              <tr><th>Family</th><th>Evidence</th><th>Top 5</th><th>Top 8</th><th>Max</th></tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.family}>
                  <td>{FAMILY[f.family] ?? f.family}</td>
                  <td>{f.eligible} / {f.labels}</td>
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
          {pairs.length} pairs have mistakes in at least {PAIR_MIN_GAMES} games. Each is counted under the first rule it
          failed. Pairs need {PAIR_MIN_PUZZLES} Lichess puzzles, or {PAIR_MIN_OWN_POSITIONS} of your own positions when
          they are trained from your games (marked &ldquo;own&rdquo;).
        </p>
        <div className="table-wrap">
          <table className="check-table">
            <thead>
              <tr><th>Outcome</th><th>Puzzle pairs</th><th>Own positions</th></tr>
            </thead>
            <tbody>
              {OUTCOME_ORDER.map((o) => {
                const n = (positional: boolean) => pairs.filter((p) => p.outcome === o && p.positional === positional).length;
                if (!n(true) && !n(false)) return null;
                return <tr key={o}><td>{OUTCOME[o]}</td><td>{n(false)}</td><td>{n(true)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginTop: "1rem" }}>Stopped only by too few puzzles or positions</h3>
        <PairTable pairs={pairs.filter((p) => p.outcome === "fewPositions")} empty="None." />

        <h3 style={{ marginTop: "1rem" }}>Shown in the top list</h3>
        <PairTable pairs={pairs.filter((p) => p.outcome === "shown")} empty="None." />

        <details style={{ marginTop: "1rem" }}>
          <summary className="small">All {pairs.length} pairs</summary>
          <PairTable pairs={pairs} empty="None." outcome />
        </details>
      </section>

      <PositionRatings positions={history.positions} level={Math.round(history.rating.rating)} />
    </>
  );
}
