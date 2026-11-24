// Where the emailed sign-in link lands. Swaps the one-time code for a login session.
// Handles both link styles Supabase can send: ?code=... (default) and ?token_hash=...&type=...

import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const supabase = await createAuthClient();

  let ok = false;
  if (supabase && code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (supabase && tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }
  return NextResponse.redirect(new URL(ok ? "/" : "/login?error=link", request.url));
}
