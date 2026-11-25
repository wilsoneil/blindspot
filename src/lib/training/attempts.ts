// Records puzzle attempts and training sessions (SPEC.md -> "Puzzle experience").
// Server-only. The browser reports what happened (right or wrong, time, retries, reveal);
// everything that affects ratings is decided here: the puzzle's rating at the time, the
// target time and whether this is the user's first attempt at the puzzle.

import type { Db } from "../db";
import type { Settings } from "../settings";
import { targetTimeMs } from "./play";

export const MODES = ["drill", "rush", "survival", "blindspot"] as const;
export type Mode = (typeof MODES)[number];

/** Longest solve time stored: a puzzle left open for hours isn't a real solve time. */
export const MAX_SOLVE_MS = 60 * 60 * 1000;

export interface AttemptInput {
  puzzleId: string;
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
}

export class AttemptError extends Error {}

function check(error: { message: string } | null, what: string) {
  if (error) throw new Error(`Could not ${what}: ${error.message}`);
}

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

/** Saves one attempt at a Lichess puzzle and updates its session's tally. */
export async function recordPuzzleAttempt(
  db: Pick<Db, "from">, userId: string, settings: Settings, input: AttemptInput, level: number,
): Promise<AttemptOutcome> {
  if (!MODES.includes(input.mode)) throw new AttemptError("Unknown training mode.");
  if (!Number.isFinite(input.solveMs) || !Number.isFinite(input.wrongMoves)) throw new AttemptError("Bad attempt data.");

  const { data: puzzle, error: puzzleErr } = await db.from("puzzles")
    .select("id, moves, rating, labels").eq("id", input.puzzleId).maybeSingle();
  check(puzzleErr, "read the puzzle");
  if (!puzzle) throw new AttemptError("That puzzle isn't in the store.");
  const p = puzzle as { id: string; moves: string; rating: number; labels: string[] };

  // The session must be the user's own; otherwise start a new one.
  let sessionId = input.sessionId;
  if (sessionId !== null) {
    const { data, error } = await db.from("training_sessions")
      .select("id").eq("id", sessionId).eq("user_id", userId).maybeSingle();
    check(error, "read the training session");
    if (!data) sessionId = null;
  }
  sessionId ??= await startSession(db, userId, input);

  const userMoves = p.moves.split(" ").filter(Boolean).length / 2;
  const targetMs = targetTimeMs({ userMoves, puzzleRating: p.rating, level, setting: settings.targetTime });
  const solveMs = Math.min(MAX_SOLVE_MS, Math.max(0, Math.round(input.solveMs)));
  const retries = Math.max(0, Math.round(input.wrongMoves));
  const correct = input.solved && !input.revealed && retries === 0;
  const fullySolved = correct && solveMs <= targetMs;

  const { data: earlier, error: earlierErr } = await db.from("puzzle_attempts")
    .select("id").eq("user_id", userId).eq("puzzle_id", p.id).limit(1);
  check(earlierErr, "read earlier attempts");

  const row = (first: boolean) => ({
    user_id: userId, session_id: sessionId, mode: input.mode, puzzle_id: p.id, labels: p.labels,
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

  const { data: s, error: sErr } = await db.from("training_sessions")
    .select("attempted, solved").eq("id", sessionId).single();
  check(sErr, "read the training session");
  const session = {
    attempted: (s as { attempted: number }).attempted + 1,
    solved: (s as { solved: number }).solved + (fullySolved ? 1 : 0),
  };
  const { error: updErr } = await db.from("training_sessions")
    .update({ ...session, ended_at: new Date().toISOString() }).eq("id", sessionId);
  check(updErr, "update the training session");

  return { sessionId, firstAttempt, correct, fullySolved, targetMs, session };
}
