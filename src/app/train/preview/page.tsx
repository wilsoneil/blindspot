// A temporary page for trying the puzzle board (Phase 3, step 3). Nothing is saved.
// Replaced by Drill in step 4.

import Link from "next/link";
import { redirect } from "next/navigation";
import { describeKey } from "@/lib/analysis/profile";
import { getAppContext } from "@/lib/app-data";
import { DEFAULT_LEVEL, selectPuzzles, trainingSource } from "@/lib/training/select";
import { targetTimeMs } from "@/lib/training/play";
import { loadProfiles, profileKeyForSetting } from "@/lib/weakness-store";
import { SetupNotice } from "../../setup-notice";
import { PreviewBoard } from "./preview-board";

export default async function PuzzlePreview({ searchParams }: PageProps<"/train/preview">) {
  const ctx = await getAppContext();
  if (ctx.status === "signed-out") redirect("/login");
  if (ctx.status !== "ready") return <SetupNotice ctx={ctx} />;

  const [profiles, params] = await Promise.all([loadProfiles(ctx.db, ctx.userId), searchParams]);
  const profile = profiles.find((p) => p.profileKey === profileKeyForSetting(ctx.settings.focusTimeControl));
  const trainable = (profile?.top ?? [])
    .slice(0, ctx.settings.weaknessesShown)
    .map((w) => ({ key: w.key, source: trainingSource(w.labels) }))
    .filter((w) => w.source.kind === "puzzles");
  const asked = typeof params.w === "string" ? params.w : null;
  const chosen = trainable.find((w) => w.key === asked) ?? trainable[0];

  const puzzle = chosen?.source.kind === "puzzles"
    ? (await selectPuzzles(ctx.db, { userId: ctx.userId, puzzleLabels: chosen.source.puzzleLabels, count: 1 }))[0]
    : undefined;

  return (
    <section className="card">
      <h1>Puzzle board preview</h1>
      <p className="small muted">
        A first look at the board. Nothing is saved yet; Drill mode, with attempts logged, comes next.
      </p>
      {trainable.length > 0 && (
        <nav className="filters" aria-label="Weakness">
          {trainable.map((w) => (
            <Link
              key={w.key}
              href={`/train/preview?w=${encodeURIComponent(w.key)}`}
              className={w.key === chosen?.key ? "filter active" : "filter"}
              aria-current={w.key === chosen?.key ? "page" : undefined}
            >
              {describeKey(w.key)}
            </Link>
          ))}
        </nav>
      )}
      {puzzle ? (
        <PreviewBoard
          puzzle={{ id: puzzle.id, fen: puzzle.fen, moves: puzzle.moves, rating: puzzle.rating }}
          targetMs={targetTimeMs({
            userMoves: puzzle.moves.length / 2, puzzleRating: puzzle.rating, level: DEFAULT_LEVEL, setting: ctx.settings.targetTime,
          })}
        />
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>
          {trainable.length === 0
            ? "None of your top weaknesses can be trained with Lichess puzzles yet."
            : "No puzzles found for this weakness."}
        </p>
      )}
    </section>
  );
}
