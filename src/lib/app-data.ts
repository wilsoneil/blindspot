// Data loading for pages. Server-only.

import { connection } from "next/server";
import { cache } from "react";
import { authEnv, getSignedInUser } from "./auth";
import { getDb, type Db } from "./db";
import { DEFAULT_SETTINGS, settingsFromRow, type Settings, type SettingsRow } from "./settings";
import { getUserIdForLogin } from "./user";

export type AppContext =
  | { status: "ready"; db: Db; userId: string; email: string; settings: Settings }
  | { status: "signed-out"; settings: Settings }
  | { status: "not-configured"; missing: "database" | "login"; settings: Settings }
  | { status: "error"; message: string; settings: Settings };

/**
 * Checks the login, then loads the database connection, user and settings, once per request.
 * Fails closed: without a valid, allowed login, no data is loaded at all.
 * `cache` means the layout and the page share one lookup instead of doing it twice.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  await connection(); // always read fresh data at request time, never at build time
  const db = getDb();
  if (!db) return { status: "not-configured", missing: "database", settings: DEFAULT_SETTINGS };
  if (!authEnv()) return { status: "not-configured", missing: "login", settings: DEFAULT_SETTINGS };

  const login = await getSignedInUser();
  if (!login) return { status: "signed-out", settings: DEFAULT_SETTINGS };

  try {
    const userId = await getUserIdForLogin(db, login.authUserId);
    const { data, error } = await db.from("settings").select("*").eq("user_id", userId).single();
    if (error) throw new Error(error.message);
    return { status: "ready", db, userId, email: login.email, settings: settingsFromRow(data as SettingsRow) };
  } catch (e) {
    console.error("Database error", e);
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Unknown error",
      settings: DEFAULT_SETTINGS,
    };
  }
});
