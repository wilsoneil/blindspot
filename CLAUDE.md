# Blindspot

A chess weakness trainer: it analyses the user's chess.com games, finds their weaknesses and trains only those using rated Lichess puzzles. The full product spec is in [SPEC.md](SPEC.md), which is the source of truth. Read the relevant section before starting work.

## Current status

- Phase 1A (hello-world page deployed from GitHub to Vercel): done
- Phase 1 (Foundations, including login): done. Sign-in live; games imported (daily import scheduled); puzzle store built (155,285 puzzles, every label covered; labels reviewed against the full Lichess database)
- Phase 2 (Analysis): done. Migration 0004 applied; 12-month backlog analysed (684 blitz games, 2,560 mistakes); the first real profile looks sensible (a mix of single labels and endgame pairs). Daily analysis runs after the import
- Phase 3 (Training): in progress. Decisions in SPEC.md (target time, repetition schedule, accepted moves; Blindspot rating calculated from Phase 3, shown in Phase 4). Steps 1–8 done; migration 0005 applied

### Phase 3 plan (one pull request per step)

1. Attempts tables (migration 0005) and a puzzle build that keeps attempted puzzles: **done**
2. Puzzle selection for a weakness (label or pair), near the user's level, skipping seen ones: **done** (`src/lib/training/select.ts`)
3. Puzzle board (chessground): move checking, alternative mates, promotion, timer: **done** (`src/lib/training/play.ts`, `src/app/train/puzzle-board.tsx`)
4. Drill mode and attempt logging (first-attempt rule): **done** (`/train/drill`, `src/lib/training/attempts.ts`, server actions in `src/app/train/actions.ts`)
5. Analysis board, optional in-browser Stockfish: **done** (`src/app/train/analysis-board.tsx`; engine files in `public/stockfish/`)
6. Glicko-2 Blindspot rating, hidden; adaptive difficulty: **done** (`src/lib/training/rating.ts`, replayed from first attempts, no table)
7. Puzzle scores in the profile blend: **done** (`src/lib/analysis/puzzle-scores.ts`; rebuilt daily and every 10 puzzles in a session)
8. Rush and Survival: **done** (`/train/rush`, `/train/survival`, ladder in `src/lib/training/run.ts`)
9. Blindspot mode and the review queue
10. Positional "find the move" drills (analysis job stores accepted moves and subtlety; backfill)
11. Openings: chess.com names to Lichess `OpeningTags`
12. Review: positional pairs' 200 rule, tactics dominance; mark Phase 3 done

Update this section when a phase is finished.

### Notes for later phases

- **Phase 3, ratings:** each attempt stores the puzzle's Lichess rating at the time (`puzzle_attempts.puzzle_rating`); the Blindspot rating must use that, not the current `puzzles.rating`.
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
