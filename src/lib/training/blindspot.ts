// Puzzles for Blindspot mode (SPEC.md -> "Training modes"): all the top weaknesses, shuffled
// and unlabelled, plus past failures and slow solves that are due for review.

import type { Db } from "../db";
import { dueReviews } from "./review";
import { attemptedPuzzleIds, selectPuzzles, type TrainingPuzzle } from "./select";

/** At most this share of a batch is reviews, so new puzzles keep coming even with a long queue. */
export const MAX_REVIEW_SHARE = 0.5;

export interface BlindspotPuzzle extends TrainingPuzzle {
  review: boolean;
}

export async function selectBlindspot(db: Pick<Db, "from">, o: {
  userId: string;
  weaknesses: string[][];
  level: number;
  count: number;
  exclude?: Iterable<string>;
  random?: () => number;
  now?: Date;
}): Promise<BlindspotPuzzle[]> {
  const random = o.random ?? Math.random;
  const exclude = new Set(o.exclude ?? []);

  // Reviews due now (not already served in this session).
  const dueIds = (await dueReviews(db, o.userId, o.count * 2, o.now)).filter((id) => !exclude.has(id));
  const reviewIds = dueIds.slice(0, o.weaknesses.length ? Math.ceil(o.count * MAX_REVIEW_SHARE) : o.count);
  let reviews: BlindspotPuzzle[] = [];
  if (reviewIds.length) {
    const { data, error } = await db.from("puzzles").select("id, fen, moves, rating, themes, labels").in("id", reviewIds);
    if (error) throw new Error(`Could not read review puzzles: ${error.message}`);
    reviews = (data as { id: string; fen: string; moves: string; rating: number; themes: string[]; labels: string[] }[])
      .map((r) => ({ ...r, moves: r.moves.split(" ").filter(Boolean), review: true }));
  }
  for (const r of reviews) exclude.add(r.id);

  // New puzzles, taken in turn from each weakness.
  const fresh: BlindspotPuzzle[] = [];
  const want = o.count - reviews.length;
  if (want > 0 && o.weaknesses.length) {
    const attempted = await attemptedPuzzleIds(db, o.userId);
    const per = Math.ceil(want / o.weaknesses.length) + 1;
    const lists = await Promise.all(o.weaknesses.map((labels) =>
      selectPuzzles(db, { userId: o.userId, puzzleLabels: labels, count: per, level: o.level, attempted, exclude, random })));
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
