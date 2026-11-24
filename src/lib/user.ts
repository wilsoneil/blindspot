// Which Blindspot user belongs to a login?
//
// Each users row is linked to one Supabase login (users.auth_user_id). On someone's
// first sign-in:
//   - if there is a user row from before logins existed, it is linked to them, keeping
//     its settings and games (that row only exists from v1, so only the first person
//     to sign in after logins were added can take it);
//   - otherwise a new user with default settings is created.

import type { Db } from "./db";

export async function getUserIdForLogin(db: Db, authUserId: string): Promise<string> {
  const existing = await db.from("users").select("id").eq("auth_user_id", authUserId).maybeSingle();
  if (existing.error) throw new Error(`Could not read users: ${existing.error.message}`);
  if (existing.data) return existing.data.id as string;

  const unlinked = await db.from("users").select("id").is("auth_user_id", null).order("created_at").limit(1);
  if (unlinked.error) throw new Error(`Could not read users: ${unlinked.error.message}`);
  if (unlinked.data.length > 0) {
    const id = unlinked.data[0].id as string;
    const claimed = await db.from("users").update({ auth_user_id: authUserId })
      .eq("id", id).is("auth_user_id", null).select("id");
    if (claimed.error) throw new Error(`Could not link user: ${claimed.error.message}`);
    if (claimed.data.length > 0) {
      await ensureSettings(db, id);
      return id;
    }
  }

  const created = await db.from("users").insert({ auth_user_id: authUserId }).select("id").single();
  if (created.error) throw new Error(`Could not create user: ${created.error.message}`);
  const id = created.data.id as string;
  await ensureSettings(db, id);
  return id;
}

async function ensureSettings(db: Db, userId: string) {
  const { error } = await db.from("settings").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw new Error(`Could not create settings: ${error.message}`);
}
