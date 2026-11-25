# Blindspot

A chess weakness trainer: it analyses the user's chess.com games, finds their weaknesses and trains only those using rated Lichess puzzles. The full product spec is in [SPEC.md](SPEC.md), which is the source of truth. Read the relevant section before starting work.

## Current status

- Phase 1A (hello-world page deployed from GitHub to Vercel): done
- Phase 1 (Foundations, including login): done. Sign-in live; games imported (daily import scheduled); puzzle store built (155,285 puzzles, every label covered; labels reviewed against the full Lichess database)
- Phase 2 (Analysis): done. Migration 0004 applied; 12-month backlog analysed (684 blitz games, 2,560 mistakes); the first real profile looks sensible (a mix of single labels and endgame pairs). Daily analysis runs after the import
- Next: Phase 3 (Training)

Update this section when a phase is finished.

### Notes for later phases

- **Phase 3, before training goes live:** a real puzzle build removes stored puzzles it no longer selects (`src/lib/puzzle-store.ts`). Change it to keep any puzzle that has attempts, and store the puzzle's rating with each attempt (Lichess ratings drift between updates; the Blindspot rating must use the rating at the time of the attempt).
- **Phase 3, puzzle scores in the blend:** `puzzleScores` in `src/lib/analysis/profile.ts` must use the game score's scale (1 = the user's average for that label family, higher = weaker).
- **Phase 3, openings:** opening weaknesses are keyed by chess.com names (`src/lib/analysis/openings.ts`); training them needs a mapping to Lichess `OpeningTags`. Openings are not paired with other labels until then.
- **Phase 3, positional pairs:** a pair with a positional label (e.g. pawn decisions in the transition) counts the user's own mistakes as its "puzzles", so it rarely reaches 200. Revisit the 200 rule for those once real numbers exist.
- **Keep an eye on:** each label is scored against its own family, so families with many labels (tactics) can reach higher scores than small ones (phases, position states). The first real profile was acceptable, but its top five were all tactics or mates (two paired with the endgame).
- **After that:** consider a quarterly automatic puzzle rebuild (a `schedule` in `.github/workflows/build-puzzles.yml`, like the daily import), to pick up Lichess's monthly updates.

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
- **Every page and server action checks the login itself** (`getAppContext` / `getSignedInUser`). The proxy is only a first line of defence; server actions can be called directly.

## Commands

- `npm run dev`: local site; `npm test`: tests; `npm run lint`; `npm run build`
- `npm run import:games`, `npm run analyse:games -- --limit 5`, `npm run build:puzzles -- --dry-run`: data jobs (also GitHub Actions workflows)
- Database changes go in a new numbered file in `supabase/migrations/`; never edit an applied one.
- Next.js here is 16.x, newer than most training data: check `node_modules/next/dist/docs/` before using an unfamiliar API (see AGENTS.md). Cache Components is deliberately off.

## Stack

Next.js on Vercel, chessground + chess.js, Stockfish (native in GitHub Actions, WebAssembly in the browser), Supabase Postgres. See "Architecture, costs and security" in SPEC.md.
