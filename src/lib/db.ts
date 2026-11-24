// Connection to the Supabase database.
//
// Uses two environment variables, set in Vercel and GitHub settings (never in code):
//   SUPABASE_URL               e.g. https://abcd1234.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  the secret "service_role" key
//
// The key has no NEXT_PUBLIC_ prefix, so Next.js never sends it to the browser.
// Only server code (pages, server actions, scripts) may import this file.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Db = SupabaseClient;

/** Returns a database client, or null if the environment variables aren't set yet. */
export function getDb(): Db | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Like getDb, but stops with a clear message. For scripts. */
export function requireDb(): Db {
  const db = getDb();
  if (!db) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see README).");
  }
  return db;
}
