import type { AppContext } from "@/lib/app-data";

type NotReady = Extract<AppContext, { status: "not-configured" | "error" }>;

/** Shown instead of a page's content until the database and login are set up. No data is loaded. */
export function SetupNotice({ ctx }: { ctx: NotReady }) {
  if (ctx.status === "error") {
    return (
      <section className="card problem">
        <h2>Can&apos;t reach the database</h2>
        <p>The settings are in place but the database answered with an error:</p>
        <p className="small"><code>{ctx.message}</code></p>
        <p className="small muted">
          Run every file in <code>supabase/migrations/</code> in order in the Supabase SQL Editor (&quot;permission
          denied&quot; or a missing column usually means one was missed). Otherwise check the environment variables in
          Vercel, and that the key is the secret (service_role) key, not the publishable one.
        </p>
      </section>
    );
  }
  if (ctx.missing === "login") {
    return (
      <section className="card notice">
        <h2>Set up sign-in</h2>
        <p>The database is connected, but sign-in isn&apos;t set up yet, so nothing is shown.</p>
        <ol className="steps small">
          <li>In Vercel → Environment Variables, add <code>SUPABASE_PUBLISHABLE_KEY</code> (Supabase → API Keys → publishable key) and <code>ALLOWED_EMAILS</code> (your email).</li>
          <li>Redeploy.</li>
        </ol>
        <p className="small muted">Full steps are in the README.</p>
      </section>
    );
  }
  return (
    <section className="card notice">
      <h2>Connect the database</h2>
      <p>Blindspot needs its Supabase database before it can store anything.</p>
      <ol className="steps small">
        <li>Create a free project at supabase.com.</li>
        <li>In its SQL Editor, run each file in <code>supabase/migrations/</code>, in order.</li>
        <li>In Vercel → Environment Variables, add <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code>, then redeploy.</li>
      </ol>
      <p className="small muted">Full steps are in the README.</p>
    </section>
  );
}
