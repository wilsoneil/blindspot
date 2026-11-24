# Blindspot

Finds the gaps in your chess from your own chess.com games and trains only those, using rated Lichess puzzles. The product spec is in [SPEC.md](SPEC.md).

## What's where

| Path | What it is |
| --- | --- |
| `src/app/` | The web pages (Next.js): home and settings |
| `src/lib/` | The logic: settings, themes, weakness labels, chess.com import, puzzle filter, database connection |
| `scripts/` | Command-line jobs: `import-games.ts` and `build-puzzles.ts` |
| `supabase/migrations/` | The database tables, as numbered SQL files |
| `tests/` | Automated tests (made-up data only) |
| `.github/workflows/` | Jobs GitHub runs: checks on pull requests, game import, puzzle build |

## One-time setup

You only do this once. Never paste keys into code, chat or commits: they go only into the settings pages named below.

### 1. Create the database (Supabase)

1. Sign up at [supabase.com](https://supabase.com) (free plan) and create a new project. Pick a region near you (e.g. London) and save the database password in your password manager.
2. Open **SQL Editor** → **New query**, paste the whole of `supabase/migrations/0001_init.sql`, and press **Run**. You should see "Success. No rows returned". Do the same with `0002_grant_service_role.sql` (and any later numbered files, in order).
3. Open **Project Settings** → **API** (or **API Keys**) and find:
   - the **Project URL** (looks like `https://abcd1234.supabase.co`)
   - the **Secret key** (starts `sb_secret_`), or the legacy **service_role** key. This key can read and change everything: treat it like a password. Not the publishable / anon key.

### 2. Tell Vercel about the database

1. In Vercel, open the blindspot project → **Settings** → **Environment Variables**, and add:
   - `SUPABASE_URL` = the Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = the service_role key (tick **Sensitive**)
2. Vercel knows this is a Next.js app from `vercel.json`, so no build settings need changing.
3. Redeploy (Deployments → ⋯ → Redeploy). The home page should now show "Foundations" instead of "Connect the database".

### 3. Set up sign-in

Blindspot signs you in with a one-tap link sent by email. Only addresses you list can get in.

1. In Supabase → **Authentication** → **URL Configuration**:
   - **Site URL**: your main Vercel address, e.g. `https://your-app.vercel.app`
   - **Redirect URLs**, add each of these (replace the parts in caps):
     - `https://YOUR-APP.vercel.app/auth/confirm`
     - `https://*-YOUR-VERCEL-TEAM.vercel.app/auth/confirm` (preview links)
     - `http://localhost:3000/auth/confirm` (local copy, optional)
2. In Supabase → **Project Settings** → **API Keys**, copy the **publishable** key (`sb_publishable_...`, or the legacy **anon** key). This one is not secret: it can start a sign-in but can't read any table.
3. In Vercel → Environment Variables, add (Production and Preview):
   - `SUPABASE_PUBLISHABLE_KEY` = the publishable key (type: Config)
   - `ALLOWED_EMAILS` = your email address; several are separated by commas (type: Secret, so it isn't on show)
4. In the Supabase SQL Editor, run `supabase/migrations/0003_auth.sql` if you haven't.
5. Redeploy. Every page now asks you to sign in; enter your email and tap the link in the email **on the same device and browser**.

### 4. Tell GitHub about the database (for the import and puzzle jobs)

In GitHub, open the repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, and add the same two: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

While you're in Settings, open **Advanced Security** (or **Code security**) and make sure **Secret Protection** / **Push protection** is on, so GitHub blocks any commit that contains a key.

### 5. First run

1. On the live site, open **Settings**, enter your chess.com username and save.
2. In GitHub → **Actions** → **Import games** → **Run workflow**. It takes a few minutes; the log shows counts only. After that it runs by itself every morning.
3. In GitHub → **Actions** → **Build puzzle store** → **Run workflow** with **dry run** ticked. Check the per-label counts in the log (none should say "none found"), then run it again with dry run unticked to save the puzzles.
4. Refresh the home page: the Foundations panel shows your games, puzzles and ratings.

## Working on it locally (optional)

Needs Node 22.

```bash
npm install
npm run dev        # the site at http://localhost:3000
npm test           # automated tests
npm run lint       # code style checks
```

To connect a local copy to the database, create a file called `.env.local` (Git ignores it) containing `SUPABASE_URL=...` and `SUPABASE_SERVICE_ROLE_KEY=...`. Then `npm run import:games` and `npm run build:puzzles -- --dry-run` also work locally.
