// Runs before every page request.
//   1. Keeps the login session fresh (Supabase tokens expire and are renewed here).
//   2. Sends anyone who isn't signed in (with an allowed email) to /login.
//
// This is the first line of defence only: every page and every save checks the login
// again itself (src/lib/app-data.ts, src/app/settings/actions.ts), as Next.js advises.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authEnv, isAllowed } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/auth/"];

export async function proxy(request: NextRequest) {
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  const env = authEnv();
  if (!env) {
    // Login isn't set up yet: pages show setup steps and load no data (they fail closed).
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const signedIn = !!data.user && isAllowed(data.user.email, env.allowed);

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Every path except Next.js's own files, the favicon, and the app manifest and icons.
  // Browsers fetch the manifest and icons without the login cookie, so they must not be
  // redirected to /login. They contain nothing personal.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)"],
};
