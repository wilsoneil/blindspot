# Blindspot

A chess weakness trainer: it analyses the user's chess.com games, finds their weaknesses and trains only those using rated Lichess puzzles. The full product spec is in [SPEC.md](SPEC.md), which is the source of truth. Read the relevant section before starting work.

## Current status

- Phase 1A (hello-world page deployed from GitHub to Vercel): done
- Phase 1 (Foundations, including login): done. Sign-in live; games imported (daily import scheduled); puzzle store built (155,285 puzzles, every label covered; labels reviewed against the full Lichess database)
- Phase 2 (Analysis): done. Migration 0004 applied; 12-month backlog analysed (684 blitz games, 2,560 mistakes); the first real profile looks sensible (a mix of single labels and endgame pairs). Daily analysis runs after the import
- Phase 3 (Training): done. Decisions in SPEC.md (target time, repetition schedule, accepted moves; Blindspot rating calculated from Phase 3, shown in Phase 4). Steps 1–12 done; migrations 0005 and 0006 applied, positions backlog filled (2,570), all games re-analysed with analysis version 2. Feedback rounds since: Blindspot mode dropped, Rush fixed at 5 minutes with 3 lives, run stats, "Your game" tag, allowed weaknesses mix own positions 1:1 with Lichess puzzles
- Phase 4 (Progress): done. Blindspot rating and Blitz gap with charts, a rating and a games trend per weakness; migration 0007 applied, weakness history backfilled; home page simplified after feedback
- Version 1 (phases 1–4): done
- AI explanations (once Phase 5): optional, not planned (Nov 2026, the user's choice); the Settings fields were removed and the `ai_*` columns in `settings` are unused. If it is ever wanted, it costs money and needs an API key: agree the provider, model and budget with the user before any code (SPEC.md "Later (optional)")

### Phase 3 plan (one pull request per step)

1. Attempts tables (migration 0005) and a puzzle build that keeps attempted puzzles: **done**
2. Puzzle selection for a weakness (label or pair), near the user's level, skipping seen ones: **done** (`src/lib/training/select.ts`)
3. Puzzle board (chessground): move checking, alternative mates, promotion, timer: **done** (`src/lib/training/play.ts`, `src/app/train/puzzle-board.tsx`)
4. Drill mode and attempt logging (first-attempt rule): **done** (`/train/drill`, `src/lib/training/attempts.ts`, server actions in `src/app/train/actions.ts`)
5. Analysis board, optional in-browser Stockfish: **done** (`src/app/train/analysis-board.tsx`; engine files in `public/stockfish/`)
6. Glicko-2 Blindspot rating, hidden; adaptive difficulty: **done** (`src/lib/training/rating.ts`, replayed from first attempts, no table)
7. Puzzle scores in the profile blend: **done** (`src/lib/analysis/puzzle-scores.ts`; rebuilt daily and every 10 puzzles in a session)
8. Rush and Survival: **done** (`/train/rush`, `/train/survival`, ladder in `src/lib/training/run.ts`)
9. Blindspot mode and the review queue: **done** (`src/lib/training/review.ts`); Blindspot mode later dropped at the user's request, and due reviews now go into Rush and Survival (`src/lib/training/run.ts`)
10. Positional "find the move" drills (analysis job stores accepted moves and subtlety; backfill): **done** (`scripts/find-moves.ts`, `src/lib/training/positions.ts`)
11. Openings: chess.com names to Lichess `OpeningTags`: **done** (`src/lib/training/openings.ts`; GIN index on `opening_tags` in migration 0006)
12. Review: positional pairs' 200 rule, tactics dominance: **done**. Profile check page (`/settings/profile-check`, `review: true` in `buildProfile`); tactics and mates scored against how common each motif is (`motif-frequency.ts`); pairs trained from own games need 25 positions (`PAIR_MIN_OWN_POSITIONS`). Tactics and mates still fill the top five after the fix: accepted as real, no cap

Update this section when a phase is finished.

### Phase 4 plan (one pull request per step)

1. Blindspot rating headline on the home page, with a week / month / all-time chart (hand-drawn SVG, theme chart colours, no chart library): **done** (`src/app/trend-chart.tsx`, `src/lib/progress/series.ts`, `ratingHistory` in `src/lib/training/rating.ts`)
2. Blitz gap: daily minus blitz rating, each a 30-day average, "600 and falling", chart, both ratings in small print: **done** (`src/lib/progress/blitz-gap.ts`; history from `games.user_rating` plus `rating_snapshots`)
3. Theme ratings: a Glicko-2 rating per weakness from first attempts at puzzles carrying its labels, on each row of the top-weaknesses list: **done** (`src/lib/progress/theme-ratings.ts`; own-position weaknesses show the share solved; openings none yet)
4. Weakness trend from games: **done**; migration 0007 applied and history backfilled (48 weeks blitz, 47 daily) (`weakness_history`; written by the daily analysis job via `rebuildProfiles(..., { history: true })`, whose first run backfills weekly points; `src/lib/progress/weakness-trend.ts`; shown per weakness as cost per game with a sparkline)
   - Feedback: home page simplified (one progress line per weakness, "How to read this" folded away, "Your data" moved to Settings, the "drilled this week" line dropped); later the Blitz gap became the home page headline and the Blindspot rating card moved to Settings (`src/app/rating-card.tsx`)
5. Review; mark Phase 4 done: **done** (every SPEC.md "Progress and headline metrics" item built; gaps below)

### Notes for later phases

- **Phase 3, ratings:** each attempt stores the puzzle's Lichess rating at the time (`puzzle_attempts.puzzle_rating`); the Blindspot rating must use that, not the current `puzzles.rating`.
- **Later, openings:** opening weaknesses are trained by Lichess `OpeningTags` (`src/lib/training/openings.ts`) but still not paired with other labels; pairing (e.g. forks in the Italian) would need `countPuzzles` to count by tag too.
- **Positional pairs (step 12, Nov 2026):** a pair trained from own games needs 25 own positions, not 200 puzzles. The count is all its mistakes, including ones already trained, so a pair can stay in the top list after its positions are used up (Drill then has nothing new); revisit if that happens.
- **Tactics dominance (step 12, Nov 2026):** the profile check showed all of the top eight were tactics or mates (tactics peaking at 3.3–3.7, openings at 1.1 despite 28 labels): every tactic counted every game as exposure, so common motifs scored high for being common. Fixed by weighting each tactic's and mate's exposure by its share of all Lichess puzzles (`src/lib/analysis/motif-frequency.ts`, from the "Motif frequencies" block of a puzzle build dry run). After the fix: tactics peaks 3.2–3.3, mates up to 3.0 (long mates replaced short ones), rare motifs didn't jump; top five still all tactics and mates, accepted as real.
- **Later, Rush length:** Rush is fixed at 5 minutes (`RUSH_MINUTES`). Bringing back a 3/5/10-minute choice needs a migration so `training_sessions` records each run's length, and `runStats` comparing like with like. The old `settings.rush_minutes` column is unused.
- **Analysis version 2 (Nov 2026):** tactic tags only for lines that win material or mate (`scripts/tagger/tag.py`); "defensive move (allowed)" never scored (`NOT_SCORED` in `src/lib/analysis/profile.ts`). Re-analysis updates mistakes in place (by game and move), so attempts at own positions survive it.
- **Speed (Nov 2026):** Vercel functions run in London (`lhr1`, `vercel.json`) next to Supabase (eu-west-2); sign-in uses `getClaims()` (`verifiedLogin`); the Blitz gap is stored daily by the import job (`blitz_gaps`, migration 0008, `src/lib/progress/blitz-gap-store.ts`). `selectPuzzles` reads from a random puzzle id instead of counting the window first. Still possible: Supabase asymmetric JWT signing keys (so `getClaims()` skips the Auth call).
- **Own-position ratings (Nov 2026):** after 100 first attempts at own positions the ±400 stand-in is replaced by a fit to the user's results (`src/lib/training/position-rating.ts`, `trainingLevel` replaces `puzzleLevel` where positions are chosen; compared on `/settings/profile-check`). Still only as good as the subtlety score; the better fix is Maia (the rating at which a human finds the move half the time), run in GitHub Actions.
- **Phase 4 gaps (Nov 2026):** openings have no theme rating (their puzzles are found by `OpeningTags`, not labels; would need attempts to record the weakness they were served for). The Blitz gap carries the last Daily rating forward, so it goes stale if Daily games stop.
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
- `npm run import:games`, `npm run analyse:games -- --limit 5`, `npm run find:moves`, `npm run build:puzzles -- --dry-run`: data jobs (also GitHub Actions workflows)
- Database changes go in a new numbered file in `supabase/migrations/`; never edit an applied one. When a migration needs applying, paste its SQL in the chat, ready to copy into the Supabase SQL editor (comments can be left out); don't just link to the file or the pull request.
- Next.js here is 16.x, newer than most training data: check `node_modules/next/dist/docs/` before using an unfamiliar API (see AGENTS.md). Cache Components is deliberately off.

## Stack

Next.js on Vercel, chessground + chess.js, Stockfish (native in GitHub Actions, WebAssembly in the browser), Supabase Postgres. See "Architecture, costs and security" in SPEC.md.
