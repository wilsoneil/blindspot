"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authEnv, createAuthClient, isAllowed } from "@/lib/auth";

export interface LinkResult {
  ok: boolean;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Emails a sign-in link, but only to allowed addresses. The reply is the same either way. */
export async function requestLink(_prev: LinkResult | null, form: FormData): Promise<LinkResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, message: "Please enter an email address." };

  const env = authEnv();
  const supabase = await createAuthClient();
  if (!env || !supabase) return { ok: false, message: "Sign-in isn't set up yet." };

  if (isAllowed(email, env.allowed)) {
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/confirm` },
    });
    if (error) console.error("Sign-in link failed:", error.message);
  }
  // Same answer for allowed and unknown addresses, so nobody can test who is allowed.
  return {
    ok: true,
    message: "If that address is allowed, a sign-in link is on its way. Open it on this device. Nothing after a few minutes? Check spam, then try again.",
  };
}

export async function signOut() {
  const supabase = await createAuthClient();
  await supabase?.auth.signOut();
  redirect("/login");
}
