"use server";

// Saves the settings form. This runs on the server, never in the browser.
//
// Server actions can be called directly by anyone who knows the site's address, so this
// checks the login itself rather than trusting that the page was shown.

import { revalidatePath } from "next/cache";
import { getSignedInUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { parseSettingsForm, SettingsError, settingsFromRow, settingsToRow, type SettingsRow } from "@/lib/settings";
import { getUserIdForLogin } from "@/lib/user";
import { rebuildProfiles } from "@/lib/weakness-store";

export interface SaveResult {
  ok: boolean;
  message: string;
}

export async function saveSettings(_prev: SaveResult | null, form: FormData): Promise<SaveResult> {
  const login = await getSignedInUser();
  if (!login) return { ok: false, message: "Please sign in again." };
  const db = getDb();
  if (!db) return { ok: false, message: "The database isn't connected yet." };

  let rebuilt = false;
  try {
    const settings = parseSettingsForm(form);
    const userId = await getUserIdForLogin(db, login.authUserId);
    const { data: before, error: readErr } = await db.from("settings").select("*").eq("user_id", userId).single();
    if (readErr) throw new Error(readErr.message);
    const old = settingsFromRow(before as SettingsRow);

    const { error } = await db
      .from("settings")
      .update({ ...settingsToRow(settings), updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    // These change the weakness scores, so the profiles are rebuilt straight away.
    if (old.halfLifeDays !== settings.halfLifeDays || old.gamesWeightPct !== settings.gamesWeightPct
      || old.historyMonths !== settings.historyMonths) {
      await rebuildProfiles(db, userId, settings);
      rebuilt = true;
    }
  } catch (e) {
    if (e instanceof SettingsError) return { ok: false, message: e.message };
    console.error("Saving settings failed", e);
    return { ok: false, message: "Couldn't save. Please try again." };
  }

  revalidatePath("/", "layout"); // re-render every page, so a theme change shows at once
  return { ok: true, message: rebuilt ? "Saved, and your weakness profile has been updated." : "Saved." };
}
