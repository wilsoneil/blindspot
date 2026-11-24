// Data loading for pages. Server-only.

import { connection } from "next/server";
import { cache } from "react";
import { getDb, type Db } from "./db";
import { DEFAULT_SETTINGS, settingsFromRow, type Settings, type SettingsRow } from "./settings";
import { getCurrentUserId } from "./user";

export type AppContext =
  | { status: "ready"; db: Db; userId: string; settings: Settings }
  | { status: "not-configured"; settings: Settings }
  | { status: "error"; message: string; settings: Settings };

/**
 * Loads the database connection, current user and their settings, once per request.
 * `cache` means the layout and the page share one lookup instead of doing it twice.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  await connection(); // always read fresh data at request time, never at build time
  const db = getDb();
  if (!db) return { status: "not-configured", settings: DEFAULT_SETTINGS };
  try {
    const userId = await getCurrentUserId(db);
    const { data, error } = await db.from("settings").select("*").eq("user_id", userId).single();
    if (error) throw new Error(error.message);
    return { status: "ready", db, userId, settings: settingsFromRow(data as SettingsRow) };
  } catch (e) {
    console.error("Database error", e);
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Unknown error",
      settings: DEFAULT_SETTINGS,
    };
  }
});
