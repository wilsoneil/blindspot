import type { AppContext } from "@/lib/app-data";

/** Shown instead of a page's content until the database is connected. */
export function SetupNotice({ ctx }: { ctx: Exclude<AppContext, { status: "ready" }> }) {
  if (ctx.status === "error") {
    return (
      <section className="card problem">
        <h2>Can&apos;t reach the database</h2>
        <p>The settings are in place but the database answered with an error:</p>
        <p className="small"><code>{ctx.message}</code></p>
        <p className="small muted">
          Most likely the tables haven&apos;t been created yet: run <code>supabase/migrations/0001_init.sql</code> in
          the Supabase SQL Editor. Otherwise check the two environment variables in Vercel.
        </p>
      </section>
    );
  }
  return (
    <section className="card notice">
      <h2>Connect the database</h2>
      <p>Blindspot needs its Supabase database before it can store anything.</p>
      <ol className="steps small">
        <li>Create a free project at supabase.com.</li>
        <li>In its SQL Editor, run <code>supabase/migrations/0001_init.sql</code> from the repo.</li>
        <li>In Vercel → Settings → Environment Variables, add <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code>, then redeploy.</li>
      </ol>
      <p className="small muted">Full steps are in the README.</p>
    </section>
  );
}
