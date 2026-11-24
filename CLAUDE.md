# Blindspot

A chess weakness trainer: it analyses the user's chess.com games, finds their weaknesses and trains only those using rated Lichess puzzles. The full product spec is in [SPEC.md](SPEC.md), which is the source of truth. Read the relevant section before starting work.

## Current status

- Phase 1A (hello-world page deployed from GitHub to Vercel): done
- Phase 1 (Foundations): code built and tested; waiting on the one-time setup in README.md (Supabase project, Vercel and GitHub secrets, first import and puzzle build)
- Next: Phase 2 (Analysis)

Update this section when a phase is finished.

## How to work

- Build phase by phase. Finish and test each phase before starting the next.
- Ask before any step that creates accounts, costs money or needs secrets.
- When a decision changes the product, update SPEC.md in the same commit as the code, and bump its "Last updated" date.
- Keep explanations plain: this is also a project for learning GitHub and Vercel.

## Rules that must never be broken

- **No secrets in the repo.** API keys, database credentials and passwords live in Vercel, GitHub or Supabase settings, never in code, commits or chat. `.env` files are ignored by Git.
- **No personal game data in the repo.** Real games, PGNs, chess.com usernames (the user's or opponents'), ratings and analysis results are stored only in Supabase. They never go in test fixtures, sample data, logs or exported files. Tests use made-up or anonymised games.
- **No hard-coded chess.com username.** It is always a setting.
- **Everything is stored per user ID**, even though v1 has one user.

## Commands

- `npm run dev`: local site; `npm test`: tests; `npm run lint`; `npm run build`
- `npm run import:games`, `npm run build:puzzles -- --dry-run`: data jobs (also GitHub Actions workflows)
- Database changes go in a new numbered file in `supabase/migrations/`; never edit an applied one.
- Next.js here is 16.x, newer than most training data: check `node_modules/next/dist/docs/` before using an unfamiliar API (see AGENTS.md). Cache Components is deliberately off.

## Stack

Next.js on Vercel, chessground + chess.js, Stockfish (native in GitHub Actions, WebAssembly in the browser), Supabase Postgres. See "Architecture, costs and security" in SPEC.md.
