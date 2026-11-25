// Puzzles for Blindspot mode (SPEC.md -> "Training modes"): all the top weaknesses, shuffled
// and unlabelled, plus past failures and slow solves that are due for review.

import type { Db } from "../db";
import { positionFromMistake } from "./positions";
import { dueReviews } from "./review";
import { attemptedPuzzleIds, type TrainingPuzzle } from "./select";
import { selectFor, type Weakness } from "./sources";

/** At most this share of a batch is reviews, so new puzzles keep coming even with a long queue. */
export const MAX_REVIEW_SHARE = 0.5;

export interface BlindspotPuzzle extends TrainingPuzzle {
  review: boolean;
}

/** The puzzles and positions behind some review items. */
async function loadReviews(db: Pick<Db, "from">, userId: string, ids: { puzzles: string[]; mistakes: number[] }, level: number) {
  const out: BlindspotPuzzle[] = [];
  if (ids.puzzles.length) {
    const { data, error } = await db.from("puzzles").select("id, fen, moves, rating, themes, labels").in("id", ids.puzzles);
    if (error) throw new Error(`Could not read review puzzles: ${error.message}`);
    for (const r of data as { id: string; fen: string; moves: string; rating: number; themes: string[]; labels: string[] }[]) {
      out.push({ ...r, moves: r.moves.split(" ").filter(Boolean), review: true });
    }
  }
  if (ids.mistakes.length) {
    const { data, error } = await db.from("mistakes")
      .select("id, fen, labels, accepted_moves, subtlety, played_san, best_san, played_at")
      .eq("user_id", userId).in("id", ids.mistakes);
    if (error) throw new Error(`Could not read review positions: ${error.message}`);
    for (const m of data as Parameters<typeof positionFromMistake>[0][]) {
      if (m.accepted_moves?.length) out.push({ ...positionFromMistake(m, level), review: true });
    }
  }
  return out;
}

export async function selectBlindspot(db: Pick<Db, "from">, o: {
  userId: string;
  weaknesses: Weakness[];
  level: number;
  count: number;
  exclude?: Iterable<string>;
  random?: () => number;
  now?: Date;
}): Promise<BlindspotPuzzle[]> {
  const random = o.random ?? Math.random;
  const exclude = new Set(o.exclude ?? []);

  // Reviews due now (not already served in this session).
  const cap = o.weaknesses.length ? Math.ceil(o.count * MAX_REVIEW_SHARE) : o.count;
  const due = (await dueReviews(db, o.userId, o.count * 2, o.now))
    .filter((r) => !exclude.has("puzzleId" in r ? r.puzzleId : `m${r.mistakeId}`))
    .slice(0, cap);
  const reviews = await loadReviews(db, o.userId, {
    puzzles: due.flatMap((r) => ("puzzleId" in r ? [r.puzzleId] : [])),
    mistakes: due.flatMap((r) => ("mistakeId" in r ? [r.mistakeId] : [])),
  }, o.level);
  for (const r of reviews) exclude.add(r.id);

  // New puzzles, taken in turn from each weakness.
  const fresh: BlindspotPuzzle[] = [];
  const want = o.count - reviews.length;
  if (want > 0 && o.weaknesses.length) {
    const attempted = await attemptedPuzzleIds(db, o.userId);
    const per = Math.ceil(want / o.weaknesses.length) + 1;
    const lists = await Promise.all(o.weaknesses.map((w) =>
      selectFor(db, w, { userId: o.userId, count: per, level: o.level, attempted, exclude, random })));
    for (let k = 0; k < per && fresh.length < want; k++) {
      for (const list of lists) {
        const p = list[k];
        if (p && !exclude.has(p.id) && fresh.length < want) {
          exclude.add(p.id);
          fresh.push({ ...p, review: false });
        }
      }
    }
  }

  const all = [...reviews, ...fresh];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}
