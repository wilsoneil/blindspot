// Sign-in with Supabase Auth (emailed one-tap links, no passwords).
//
// Environment variables (Vercel settings, never in code):
//   SUPABASE_URL              the project URL (already set)
//   SUPABASE_PUBLISHABLE_KEY  the public "publishable" (or legacy "anon") key. Not secret:
//                             it can only start sign-ins and can't read any table.
//   ALLOWED_EMAILS            who may use the app, comma separated
//
// Anyone can create a Supabase login through the public API, so the allowlist is
// checked on every request, not just when the link is sent.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export interface SignedInUser {
  authUserId: string;
  email: string;
}

export function authEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const allowed = process.env.ALLOWED_EMAILS;
  if (!url || !key || !allowed) return null;
  return { url, key, allowed: parseAllowlist(allowed) };
}

export function parseAllowlist(value: string): Set<string> {
  return new Set(value.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export function isAllowed(email: string | undefined | null, allowlist: Set<string>): boolean {
  return !!email && allowlist.has(email.trim().toLowerCase());
}

/** A Supabase client that keeps the login session in cookies. One per request. */
export async function createAuthClient() {
  const env = authEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Pages can't set cookies; the proxy refreshes them instead.
        }
      },
    },
  });
}

/** The signed-in, allowed user, or null. Checks the session with Supabase, not just the cookie. */
export async function getSignedInUser(): Promise<SignedInUser | null> {
  const env = authEnv();
  const supabase = await createAuthClient();
  if (!env || !supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !isAllowed(data.user.email, env.allowed)) return null;
  return { authUserId: data.user.id, email: data.user.email! };
}
