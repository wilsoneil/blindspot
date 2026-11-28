// Records puzzle attempts and training sessions (SPEC.md -> "Puzzle experience").
// Server-only. The browser reports what happened (right or wrong, time, retries, reveal);
// everything that affects ratings is decided here: the puzzle's rating at the time, the
// target time and whether this is the user's first attempt at the puzzle.

import type { Db } from "../db";
import { check } from "../read-all";
import type { Settings } from "../settings";
import { itemTargetMs } from "./play";
import { updateReview, type ReviewChange, type ReviewItem } from "./review";

// ("blindspot" was a fourth mode until Nov 2026; the database still allows it for old rows.)
export const MODES = ["drill", "rush", "survival"] as const;
export type Mode = (typeof MODES)[number];

/** Longest solve time stored: a puzzle left open for hours isn't a real solve time. */
export const MAX_SOLVE_MS = 60 * 60 * 1000;

export interface AttemptInput {
  /** A Lichess puzzle, or (mistakeId) a "find the move" position from the user's own game. */
  puzzleId?: string;
  mistakeId?: number;
  /** The session this attempt belongs to; null starts a new one. */
  sessionId: number | null;
  mode: Mode;
  profileKey: string;
  /** Drill only: the weakness being trained. */
  weaknessKey?: string | null;
  /** Reached the end of the solution (by playing it, not by revealing it). */
  solved: boolean;
  solveMs: number;
  wrongMoves: number;
  revealed: boolean;
}

export interface AttemptOutcome {
  sessionId: number;
  firstAttempt: boolean;
  /** Solved with no wrong move and no reveal. */
  correct: boolean;
  /** Correct within the target time: the only result that counts as fully solved. */
  fullySolved: boolean;
  targetMs: number;
  session: { attempted: number; solved: number };
  /** What happened to the puzzle's place on the review queue. */
  review: ReviewChange;
}

export class AttemptError extends Error {}

/** Starts a training session. */
export async function startSession(
  db: Pick<Db, "from">, userId: string, o: { mode: Mode; profileKey: string; weaknessKey?: string | null },
): Promise<number> {
  const { data, error } = await db.from("training_sessions")
    .insert({ user_id: userId, mode: o.mode, profile_key: o.profileKey, weakness_key: o.weaknessKey ?? null, attempted: 0, solved: 0 })
    .select("id").single();
  check(error, "start a training session");
  return (data as { id: number }).id;
}

/** What was attempted: its labels, rating (Lichess puzzles only) and moves to play. */
type Item = { column: "puzzle_id" | "mistake_id"; id: string | number; labels: string[]; rating: number | null; userMoves: number };

/** Checks the attempt data, then loads what was attempted. */
async function loadItem(db: Pick<Db, "from">, userId: string, input: AttemptInput): Promise<Item> {
  if (!MODES.includes(input.mode)) throw new AttemptError("Unknown training mode.");
  if (!Number.isFinite(input.solveMs) || !Number.isFinite(input.wrongMoves)) throw new AttemptError("Bad attempt data.");
  if (typeof input.mistakeId === "number") {
    // The user's own position: it must be one of their mistakes.
    const { data, error } = await db.from("mistakes")
      .select("id, labels").eq("id", input.mistakeId).eq("user_id", userId).maybeSingle();
    check(error, "read the position");
    if (!data) throw new AttemptError("That position isn't one of yours.");
    const m = data as { id: number; labels: string[] };
    return { column: "mistake_id", id: m.id, labels: m.labels, rating: null, userMoves: 1 };
  }
  if (typeof input.puzzleId !== "string") throw new AttemptError("Bad attempt data.");
  const { data, error } = await db.from("puzzles")
    .select("id, moves, rating, labels").eq("id", input.puzzleId).maybeSingle();
  check(error, "read the puzzle");
  if (!data) throw new AttemptError("That puzzle isn't in the store.");
  const p = data as { id: string; moves: string; rating: number; labels: string[] };
  return { column: "puzzle_id", id: p.id, labels: p.labels, rating: p.rating, userMoves: p.moves.split(" ").filter(Boolean).length / 2 };
}

type SessionTally = { id: number; attempted: number; solved: number };

/** The session with its tally so far, if it is the user's own. */
async function ownSession(db: Pick<Db, "from">, userId: string, sessionId: number | null): Promise<SessionTally | null> {
  if (sessionId === null) return null;
  const { data, error } = await db.from("training_sessions")
    .select("id, attempted, solved").eq("id", sessionId).eq("user_id", userId).maybeSingle();
  check(error, "read the training session");
  return data as SessionTally | null;
}

/**
 * Saves one attempt at a Lichess puzzle or one of the user's own positions, and updates its
 * session's tally and the review queue. Own positions never count towards the rating
 * (they have no puzzle rating), but are logged the same way. `level` may be a promise, so
 * the caller's rating read runs alongside the reads here.
 */
export async function recordPuzzleAttempt(
  db: Pick<Db, "from">, userId: string, settings: Settings, input: AttemptInput, level: number | Promise<number>,
): Promise<AttemptOutcome> {
  const [p, own, lvl] = await Promise.all([loadItem(db, userId, input), ownSession(db, userId, input.sessionId), level]);
  // The session must be the user's own; otherwise start a new one.
  const tally: SessionTally = own ?? { id: await startSession(db, userId, input), attempted: 0, solved: 0 };
  const sessionId = tally.id;

  const targetMs = itemTargetMs(p, lvl, settings.targetTime);
  const solveMs = Math.min(MAX_SOLVE_MS, Math.max(0, Math.round(input.solveMs)));
  const retries = Math.max(0, Math.round(input.wrongMoves));
  const correct = input.solved && !input.revealed && retries === 0;
  const fullySolved = correct && solveMs <= targetMs;

  const { data: earlier, error: earlierErr } = await db.from("puzzle_attempts")
    .select("id").eq("user_id", userId).eq(p.column, p.id).limit(1);
  check(earlierErr, "read earlier attempts");

  const row = (first: boolean) => ({
    user_id: userId, session_id: sessionId, mode: input.mode, [p.column]: p.id, labels: p.labels,
    puzzle_rating: p.rating, first_attempt: first, correct, solve_ms: solveMs, target_ms: targetMs,
    retries, revealed: input.revealed,
  });
  let firstAttempt = (earlier ?? []).length === 0;
  let { error: insertErr } = await db.from("puzzle_attempts").insert(row(firstAttempt));
  if (insertErr && firstAttempt && (insertErr as { code?: string }).code === "23505") {
    // Another attempt at the same puzzle got in first (e.g. two tabs): this one is a repeat.
    firstAttempt = false;
    ({ error: insertErr } = await db.from("puzzle_attempts").insert(row(false)));
  }
  check(insertErr, "save the attempt");

  const session = { attempted: tally.attempted + 1, solved: tally.solved + (fullySolved ? 1 : 0) };
  const item: ReviewItem = p.column === "puzzle_id" ? { puzzleId: p.id as string } : { mistakeId: p.id as number };
  const [{ error: updErr }, review] = await Promise.all([
    db.from("training_sessions").update({ ...session, ended_at: new Date().toISOString() }).eq("id", sessionId),
    updateReview(db, userId, item, fullySolved),
  ]);
  check(updErr, "update the training session");

  return { sessionId, firstAttempt, correct, fullySolved, targetMs, session, review };
}
