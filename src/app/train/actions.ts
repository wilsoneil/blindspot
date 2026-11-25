"use server";

// Training actions: saving attempts and fetching more puzzles. These run on the server.
//
// Server actions can be called directly by anyone who knows the site's address, so each
// one checks the login itself rather than trusting that the page was shown.

import { getSignedInUser } from "@/lib/auth";
import { getDb, type Db } from "@/lib/db";
import { settingsFromRow, type Settings, type SettingsRow } from "@/lib/settings";
import { AttemptError, recordPuzzleAttempt, type AttemptInput, type AttemptOutcome } from "@/lib/training/attempts";
import { clientPuzzle, type ClientPuzzle } from "@/lib/training/client-puzzle";
import { puzzleLevel } from "@/lib/training/rating";
import { selectPuzzles, trainingSource } from "@/lib/training/select";
import { getUserIdForLogin } from "@/lib/user";

type Signed = { db: Db; userId: string; settings: Settings };

async function signedIn(): Promise<Signed | null> {
  const login = await getSignedInUser();
  const db = getDb();
  if (!login || !db) return null;
  const userId = await getUserIdForLogin(db, login.authUserId);
  const { data, error } = await db.from("settings").select("*").eq("user_id", userId).single();
  if (error) throw new Error(error.message);
  return { db, userId, settings: settingsFromRow(data as SettingsRow) };
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false; message: string };

export async function saveAttempt(input: AttemptInput): Promise<ActionResult<AttemptOutcome>> {
  try {
    const ctx = await signedIn();
    if (!ctx) return { ok: false, message: "Please sign in again." };
    // The level before this attempt: the one the puzzle was served at.
    const level = await puzzleLevel(ctx.db, ctx.userId);
    const value = await recordPuzzleAttempt(ctx.db, ctx.userId, ctx.settings, input, level);
    return { ok: true, value };
  } catch (e) {
    if (e instanceof AttemptError) return { ok: false, message: e.message };
    console.error("Saving an attempt failed", e);
    return { ok: false, message: "Couldn't save this attempt." };
  }
}

/** More unseen puzzles for a weakness, skipping the ones already in this session. */
export async function morePuzzles(weaknessKey: string, exclude: string[]): Promise<ActionResult<ClientPuzzle[]>> {
  try {
    const ctx = await signedIn();
    if (!ctx) return { ok: false, message: "Please sign in again." };
    const source = trainingSource(weaknessKey.split("+"));
    if (source.kind !== "puzzles") return { ok: false, message: "This weakness can't be trained with Lichess puzzles yet." };
    const level = await puzzleLevel(ctx.db, ctx.userId);
    const puzzles = await selectPuzzles(ctx.db, {
      userId: ctx.userId, puzzleLabels: source.puzzleLabels, count: 5, level, exclude: exclude.slice(0, 500),
    });
    return { ok: true, value: puzzles.map((p) => clientPuzzle(p, ctx.settings, level)) };
  } catch (e) {
    console.error("Loading puzzles failed", e);
    return { ok: false, message: "Couldn't load more puzzles." };
  }
}
