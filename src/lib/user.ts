// Who is the current user?
//
// v1 has one user and no login, so this returns the single row in the users table,
// creating it (with default settings) on first use. When real logins arrive, this is
// the one function that changes: it will read the signed-in user instead.

import type { Db } from "./db";

export async function getCurrentUserId(db: Db): Promise<string> {
  const { data, error } = await db.from("users").select("id").order("created_at").limit(1);
  if (error) throw new Error(`Could not read users: ${error.message}`);
  if (data.length > 0) return data[0].id as string;

  const created = await db.from("users").insert({}).select("id").single();
  if (created.error) throw new Error(`Could not create user: ${created.error.message}`);
  const id = created.data.id as string;

  const settings = await db.from("settings").insert({ user_id: id });
  if (settings.error) throw new Error(`Could not create settings: ${settings.error.message}`);
  return id;
}
