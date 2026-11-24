"use server";

// Saves the settings form. This runs on the server, never in the browser.
//
// Note: until real logins exist (a later phase), anyone who knows the site's address
// could call this. It only changes settings; nothing here costs money or exposes data.

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { parseSettingsForm, SettingsError, settingsToRow } from "@/lib/settings";
import { getCurrentUserId } from "@/lib/user";

export interface SaveResult {
  ok: boolean;
  message: string;
}

export async function saveSettings(_prev: SaveResult | null, form: FormData): Promise<SaveResult> {
  const db = getDb();
  if (!db) return { ok: false, message: "The database isn't connected yet." };

  try {
    const settings = parseSettingsForm(form);
    const userId = await getCurrentUserId(db);
    const { error } = await db
      .from("settings")
      .update({ ...settingsToRow(settings), updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  } catch (e) {
    if (e instanceof SettingsError) return { ok: false, message: e.message };
    console.error("Saving settings failed", e);
    return { ok: false, message: "Couldn't save. Please try again." };
  }

  revalidatePath("/", "layout"); // re-render every page, so a theme change shows at once
  return { ok: true, message: "Saved." };
}
