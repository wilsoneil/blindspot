# Blindspot — Chess Weakness Trainer Spec

Last updated: 25 Nov 2026 ("Your game" tag on own positions)

> **For Claude Code:** this is the product spec for this repository. Build it phase by phase (see "Build phases"), finishing and testing each phase before starting the next. Ask before any step that creates accounts, costs money or needs secrets. Never put keys or passwords in code or commit them; they go in Vercel / GitHub / Supabase settings.

## Purpose

Blindspot finds the gaps in the user's chess from his own chess.com games and trains only those gaps, using rated Lichess puzzles. There is no random-puzzle mode: every puzzle is chosen because the analysis says it targets a weakness.

- Primary focus: 5-minute blitz, where speed of pattern recognition matters most
- Secondary: daily chess, as a separate profile
- Success = blitz rating closing the gap on daily rating
- Also a hands-on project for learning GitHub and Vercel

## Scope and users

Version 1 is for one user, but every piece of data is stored per user and each user is tied to a login, so more users can be added later without a rebuild.

- All games, analysis, weakness profiles, puzzle attempts and ratings are keyed to a user ID
- The chess.com username is a setting, never hard-coded
- Login (added in Phase 1): Supabase Auth with emailed one-tap sign-in links, no passwords. Only addresses on an allowlist (a Vercel setting) can use the app, checked on every request. Opening up to more users later means relaxing the allowlist and connecting a proper email sender (Supabase's built-in one only sends a few emails an hour)
- Before any public release: check chess.com API terms for commercial use, and meet UK GDPR (privacy policy, data deletion)

## Data sources

| Source | What it gives | Access |
| --- | --- | --- |
| chess.com public API | Monthly game archives (PGN with clock times), current ratings by time control | Free, no key |
| [Lichess puzzle database](https://database.lichess.org/) | About 6 million rated puzzles with themes, opening tags and popularity | Free, CC0 licence, one CSV |

The Lichess file is about 900 MB uncompressed, so a build step pre-filters it into a smaller indexed puzzle store (keep only puzzles relevant to the weakness labels; stay well under Supabase's 500 MB free limit). The app never loads the full file.

## Game analysis pipeline

A scheduled job pulls new games daily, runs Stockfish over them and turns the mistakes into tagged weaknesses.

1. **Import:** fetch new games from chess.com and store them with time control, colour, opening, result and clock data.
2. **Evaluate:** run Stockfish on every position; flag moves where the evaluation drops past a mistake threshold. The Stockfish version and search budget are pinned, so a change in a score reflects the user's play, not engine settings.
3. **Tag:** label each mistake by tactical theme (using Lichess's open-source puzzle tagger), game phase, opening, endgame type, move type, position state and colour.
4. **Profile:** update the weakness scores for that time control.

- Initial backlog: last 12 months of blitz, plus daily games for the secondary profile
- Schedule: daily (GitHub Actions), straight after the import, processing only new games. Each run has a time limit and carries on where the last one stopped, so the backlog is worked through in a few longer runs started by hand
- No time-trouble category: puzzle speed covers that

**Analysis rules (Phase 2):**

- **Engine:** Stockfish 17.1, one thread, 300,000 nodes per position (about depth 20). One thread and a fixed node count give the same result every time. The engine and tagger versions are pinned in the workflow; changing them, or any rule below, means re-analysing every game.
- **Mistake:** a move that lowers the user's chance of winning by at least 10 percentage points, using Lichess's winning-chance curve (Lichess's "mistake" level; smaller inaccuracies are ignored). The drop is the mistake's cost.
- **Allowed:** for every mistake, the opponent's best reply line is tagged as a puzzle; its tactics are "allowed".
- **Missed:** the user's best line is tagged only when there was a real chance: the opponent's previous move handed over at least 10 points of winning chance, or there was a forced mate. Its tactics are "missed".
- **Tagger:** lines are trimmed to puzzle length before tagging (a forced mate is kept to the mate; otherwise the line ends at the user's move that wins the most material, within four moves).
- **Phase:** endgame when at most six queens, rooks, bishops and knights are left in total. Otherwise the opening lasts until the user's development is done (at most one knight or bishop still at home, and the king off its starting square), but at least until move 10 and at most until move 15; the transition runs from then to move 20; then the middlegame.
- **Endgame type:** the Lichess definitions (only kings, pawns and one kind of piece; or queen and rook).
- **Position state:** from the evaluation before the move: 1.5 pawns or more up is converting, 1.5 or more down is defending, otherwise balanced.
- **Move type:** pawn decisions = the move played or the best move is a pawn move; recapture choice = the opponent has just captured and the move played or the best move takes back on that square; trade decisions = the move played or the best move swaps a piece for one of equal value.
- **Situations:** for each label, a game counts as exposed if the situation arose at any of the user's moves (the phase or endgame type was reached, the position state occurred, that kind of decision was on offer). Tactics and mates count as exposed in every game.
- **Profiles:** one per time control; all daily games share one profile.

## Weakness profile

The home screen shows the top weaknesses (default five) for the selected time control, each with a 0–100 severity score; the user picks which one to train.

- Weaknesses can be tactical themes, openings, endgame types, game phases, move types or position states
- Separate profiles per time control, with a filter; 5-minute is the default
- Severity combines two signals:
    - **Games:** how often the pattern causes mistakes, weighted by how costly they were and how recent
    - **Puzzles:** accuracy and solve time on that theme; slow solves count as "not yet automatic"
- Scores refresh as new games and puzzle results arrive
- Under each weakness, a line shows recent Drill practice on it: puzzles drilled in the last 7 days (repeats included) and the share solved correctly within target time. Puzzles met in Rush or Survival don't count towards it

### Categories

Categories come from a fixed list; every one maps to a Lichess puzzle filter (or, for positional labels, to "find the move" positions from the user's games), so every weakness is trainable. A mistake can fall into several categories at once.

**Full label list (v1):** based on the [Lichess puzzle themes](https://lichess.org/training/themes), plus labels the app computes itself.

| Family | Labels | Source |
| --- | --- | --- |
| Tactical motifs (each tracked as missed / allowed) | Fork, pin, skewer, discovered attack, discovered or double check, hanging piece, trapped piece, capture the defender, deflection, attraction, clearance, interference, intermezzo, x-ray, sacrifice, attacking f2/f7, exposed king, advanced pawn, promotion, quiet move, defensive move, kingside attack, queenside attack, zugzwang | Lichess tagger |
| Mates (each missed / allowed) | Short mates (in 1–2), longer mates (3+), back-rank mate, smothered mate, other mating patterns pooled | Lichess tagger |
| Phase | Opening, transition (development done, roughly moves 12–20), middlegame, endgame | Computed |
| Endgame type | Rook, pawn, bishop, knight, queen, queen and rook | Lichess themes |
| Openings | Families by colour; White by variation, Black by own response; offbeat bucket | Game record |
| Move type | Pawn decisions (push or recapture choice), recapture choice, trade decisions | Computed |
| Position state | Converting an advantage, defending a worse position, balanced | Computed from evaluation; defending is also trained with Lichess "equality" puzzles |

- **Missed** = the user had the tactic and didn't play it. **Allowed** = the user's move let the opponent play it.
- **Only real tactics are tagged:** the line the tagger sees (cut to puzzle length) must win material or mate; one that doesn't is a positional mistake and gets no tactical tag (it still counts under phase, endgame type, move type and position state). Before Nov 2026 such lines were tagged "defensive move", a catch-all that inflated that label, especially in daily games.
- **Defensive move (allowed)** is never scored: letting the opponent play a good defensive move isn't something a puzzle can train. Defensive move (missed), needing a defensive move and not finding it, is.
- Not used as weaknesses: Lichess goals, puzzle lengths and origins (used only for puzzle selection). The one exception: the "equality" goal (hold a draw from a worse position) supplies puzzles for "defending a worse position". "Advantage" and "crushing" describe what a puzzle's solution wins, not an already-won position, so they don't train "converting". Adding a label later should be a small change.
- Label coverage was checked against the whole Lichess database (Nov 2026): kingside attack, queenside attack, zugzwang and equality were added; en passant and castling were left out as too narrow. Each puzzle build prints the same report, so coverage can be rechecked.

**Openings by colour:**

- **White:** narrow repertoire, so plenty of games per opening; scored down to variation level (chess.com's opening name without its trailing moves)
- **Black:** grouped by the user's own response (e.g. "my defence to 1.e4", "my setup against 1.d4"), not the opponent's opening, to pool small samples. v1 groups by White's first move and the user's reply to it (e.g. "Your reply to 1.e4: 1...c5")
- **Rare openings** (a handful of games each) roll into one "Offbeat openings" bucket, which can itself surface as a weakness. An opening needs five games in the profile to stand on its own; rarer ones roll up first to the family (White's opening family, or all replies to that first move as Black), then into the bucket
- Only mistakes in the opening and transition phases count towards the game's opening
- **Training an opening** uses Lichess puzzles from games in that opening, found by their OpeningTags. White openings: chess.com's name written as a Lichess tag, trying the full variation first and then shorter names down to the family, filling up from broader names when the specific one runs short. Black replies: a fixed table of the Lichess families each reply leads to (e.g. 1.e4 c5 → Sicilian Defense; 1.e4 e5 → Italian, Ruy Lopez, Scotch and the other 1...e5 openings); an unlisted reply uses every family after White's first move. "Offbeat openings" pools too many openings to train

### Scoring method

Each category gets a score per time control:

1. **Count** every mistake in the category.
2. **Weight by cost:** the drop in winning chance, not raw engine points, so throwing away a won game counts heavily and +9 to +6 barely counts.
3. **Weight by recency:** exponential decay with a 60-day half-life (setting).
4. **Normalise by exposure:** mistakes per game in which the situation arises, compared with the user's average. The average is taken within each family of labels (missed tactics, allowed tactics, missed mates, allowed mates, phases, endgame types, openings, move types, position states), so a category scores 1 when it costs as much as is usual for its family and 2 when it costs twice as much.
5. **Require evidence:** small samples are pulled towards the average (as if every category had ten extra average games), and a category seen in fewer than three distinct games cannot enter the top list.

The game score is blended with puzzle performance on the matching theme (solved within target time, against expectation for the puzzle rating), defaulting to 70% games and 30% puzzles (setting). The puzzle score uses the same scale (1 = the user's average for that family): for each first attempt at a Lichess puzzle, the Blindspot rating just before it predicts the chance of solving it; a label's misses (failed or slow) are compared with the misses its rating predicts, weighted by recency with the same half-life, divided by the same ratio for the label's whole family, and pulled towards 1 for small samples (as if three more expected misses at the family's ratio). A label needs five attempts before its puzzle score counts; until then, and for labels Lichess puzzles don't train, the game score is used alone. A tactic's puzzle score applies to both its missed and allowed sides. Scores are rebuilt by the daily job and after every ten puzzles in a session. Blended scores are then scaled 0–100 against each other (the worst area shown is 100, the best 0), so the top list shows the weakest areas relative to the rest of the user's game.

**Combinations:** categories are also scored in pairs, never triples (e.g. "pawn decisions in the transition"). A pair only replaces its broader label when it has at least 8 distinct games of evidence, is clearly worse than the broader label on its own, and has at least 200 matching puzzles. At most two of the top five can be pairs; otherwise the broader label is shown.

- **Clearly worse:** the pair's share of the user's mistake cost is at least 1.25 times what its two labels would give if unrelated (pulled towards 1 for small samples). Its score is then the broader label's score times that factor, and it takes the place of whichever of its two labels scores higher.
- **Matching puzzles:** Lichess puzzles carrying both labels. When either label is positional (no Lichess theme), the user's own mistakes with both labels are counted instead, since those are the "find the move" positions that would train it.
- Two labels from the same family, phase with endgame type, and openings are not paired in v1 (openings are trained by their own Lichess OpeningTags; pairing them with a tactic is a possible later addition).

## Training modes

Three modes, all drawing only on puzzles matched to the weakness profile. Drill targets a single weakness; Rush and Survival mix all top weaknesses with earlier misses that are due for review. (A fourth, "Blindspot" mode, an own-pace mix of the same, was dropped in Nov 2026 as Rush and Survival cover it.)

| Mode | Puzzles from | Format | Mistakes |
| --- | --- | --- | --- |
| Drill | One chosen weakness | Timed and logged, own pace | Unlimited retries, reveal solution, analysis board |
| Rush | All top weaknesses, shuffled, plus due reviews | As many as possible in 5 minutes (fixed), rising difficulty | A wrong move ends that puzzle, no retry; three failed puzzles end the run |
| Survival | All top weaknesses, shuffled, plus due reviews | Open-ended, rising difficulty | A wrong move ends that puzzle; three failed puzzles (setting) end the run |

- **Run stats** (Rush and Survival): the start page shows the best score ever, the best this week, the last run's score and runs played; a run's score is puzzles solved correctly (time doesn't matter in a run), and the end screen marks a new best. Rush is always 5 minutes, so its scores compare; the 3/5/10-minute setting was removed in Nov 2026 (see "Later").
- **Rising difficulty** (Rush and Survival): each run is a ladder that starts 300 points below the user's Blindspot rating and rises 25 points per puzzle. Puzzles come in groups of six, each taking two from each of the next three weaknesses in turn (in a random order per run), easiest first within the group. A puzzle not finished when Rush's clock runs out isn't logged.
- Failed or slow puzzles return in later Rush and Survival runs on a spaced-repetition schedule: due again after 1, then 3, 7 and 21 days. A clean solve (correct within target time) of a puzzle that is due moves it to the next step (a clean solve before it's due, such as an immediate retry, doesn't), and one after the 21-day step leaves the schedule; a failure or slow solve in any mode sends it back to 1 day. Due reviews make up at most a third of a run (two in each group of six), so new puzzles keep coming; each goes in the group whose difficulty matches its rating, and one harder than the run has reached yet waits until it gets there. A run looks through every due review and gives the places to the oldest that fit, so a backlog of hard misses never hides easier ones. Reviews missed while away stay due until played, and the next interval counts from when the puzzle is actually played.
- **Positional weaknesses** (transition, pawn decisions, other computed labels with no Lichess theme) use "find the move" positions from the user's own games: open format, no multiple choice, and any move within a small margin of Stockfish's best is accepted. The accepted moves are worked out in advance by the analysis job (Stockfish's top five moves at the analysis node budget, kept if they are within 3 points of winning chance of the best), so the browser needs no engine to mark an answer. Drill serves them when that weakness is chosen; the mixed modes include them alongside Lichess puzzles, with difficulty approximated by how subtle the best move is: the fewer moves are accepted and the larger the gap to the next-best move, the harder the position (subtlety 0–1: the gap in winning chance to the first rejected move, full at 30 points, times 1, 0.75 or 0.5 for one, two or more accepted moves). For ordering among Lichess puzzles, a position counts as rated from 400 below the user's Blindspot rating (subtlety 0) to 400 above (subtlety 1). They are marked with a "Your game" tag in every mode, and after a Drill attempt the move played in the game and the engine's choice are shown. Positions already trained aren't served again except as reviews; misses join the same review queue as puzzles. They count towards each run's score but never towards the Blindspot rating, and are tracked separately as accuracy and speed.

## Puzzle experience

Every attempt logs the result and the time taken; both feed the weakness score and puzzle selection.

- Each puzzle is timed; the log records correct or wrong, solve time, retries and whether the solution was revealed, plus the puzzle's Lichess rating at the time (Lichess ratings drift between puzzle updates)
- **Target time:** 15 seconds per move the user has to play, 50% longer for puzzles rated 200 or more above the user's Blindspot rating. The "stricter" setting multiplies it by 0.75, "looser" by 1.5
- A puzzle only counts as fully solved if it is correct within its target time. Only the first attempt at any puzzle counts towards ratings; repeats train but don't score, so remembered answers can't inflate progress
- Analysis board from any puzzle: step back through the moves and move pieces freely to explore alternative lines
- Optional Stockfish in the browser on the analysis board: evaluation bar plus the top one or two moves, off by default so it never gives away a puzzle
- Difficulty adapts to measured puzzle performance, not chess.com game rating (the scales differ)

## Progress and headline metrics

The home screen leads with the Blindspot rating as the primary number, with the Blitz gap shown smaller beneath it; each has a line chart over the last week, month and all time.

- **Blindspot rating:** one overall Glicko-2 rating across all rated Lichess puzzles attempted in the app (first attempts only). It only rises for solves that are correct and within target time. Each attempt is its own rating period against the puzzle's Lichess rating at the time (with a fixed deviation of 80, since stored puzzles have settled ratings); it starts at 1500 (deviation 350, volatility 0.06, τ 0.5) and the deviation never drops below 45, so it keeps responding. It is worked out by replaying the first attempts in order, so its full history can always be rebuilt. Puzzles are chosen around it, and it sets the "well above the user's level" part of the target time.
- **Blitz gap:** daily rating minus blitz rating, from chess.com ratings fetched daily and smoothed as a 30-day average so a single bad session doesn't swing it. Shown in points, for example "600 and falling"; falling = closing the gap. Show both underlying ratings in small print.
- Underneath: a rating per weakness theme (leading indicator) and each weakness score's trend from games (lagging indicator, showing whether training carries over to real play)

## Settings

One settings page holds every adjustable choice; defaults are what the spec describes.

| Setting | Default | Range or options |
| --- | --- | --- |
| chess.com username | (set on first run) | Any username |
| Focus time control | 5-minute blitz | Any time control played |
| Number of weaknesses shown | 5 | 3–8; fewer shown if fewer pass the evidence rule |
| Games vs puzzles blend | 70 / 30 | 0–100% games |
| Recency half-life | 60 days | 14–365 days |
| Analysis history window | Last 12 months | 3 months to all games |
| Target solve time | 15 s per move to play, +50% for puzzles well above the user's level | Stricter (×0.75), normal or looser (×1.5) |
| Survival lives | 3 | 1–5 |
| Engine on analysis board | Off | On / off |
| Theme | Slate | Slate, Tournament, Paper |
| AI explanations: monthly budget | £5 | Any amount; off |
| AI explanations: daily limit | 20 | Any number |

The AI usage panel (explanations and estimated spend this month) also sits on this page.

## Look and feel

Clean and simple, phone-first, installable to the Android home screen (PWA), built on a theme system where a new theme is one small config file.

| Theme | Palette | Use |
| --- | --- | --- |
| Slate (default) | Blue and grey | Everyday |
| Tournament | Dark green and near-black | Classic club-board feel, dark |
| Paper | Light, warm neutrals | Daytime |

Each theme sets the board squares, UI colours and chart colours together.

## Architecture, costs and security

Everything runs on free tiers; the heavy analysis runs on GitHub's servers, and the phone only talks to Vercel.

```
chess.com API ──> Daily analysis job (GitHub Actions: Stockfish + tagger) ──┐
                                                                             ├──> Database (Supabase)
Lichess puzzle DB ──> Puzzle filter (one-off build step) ───────────────────┘          ▲
                                                                                        │ reads/writes
GitHub repo ──(deploys on every change)──> Vercel (web app + server functions) ────────┘
                                                   │
                                                   ▼
                                     Phone (browser / home-screen app;
                                     Stockfish WASM for the analysis board)
```

- **Stack:** Next.js web app on Vercel; chessground board and chess.js rules; Stockfish (native in the job, WebAssembly in the browser); Supabase Postgres database
- **Costs:** GitHub Actions is free and unlimited on a public repo, or 2,000 minutes a month on a private one. The 12-month backlog fits within one month. Vercel (Hobby, personal non-commercial) and Supabase free tiers cover one user. Supabase free projects pause after a week without database activity; the daily job keeps it active.
- **Secrets:** the only API key is for the AI explanations (chess.com and Lichess are open); it sits in a Vercel server function with a spending cap. The database credentials and any future key live in Vercel and GitHub settings, never in code or chat. `.env` is ignored by Git from the first commit, and secret scanning is on.
- **Personal game data:** chess.com game records contain the user's and opponents' usernames, so imported games, analysis results and ratings are stored only in Supabase. They are never committed to the repo: no real games in test fixtures, sample data, logs or exported files. Tests use made-up or anonymised games.

## Build phases and out of scope

Version 1 is phases 1–5; nothing is trainable until the analysis runs.

**Phase 1A (warm-up, done):** a "hello world" page deployed from GitHub to Vercel

1. **Foundations:** Next.js app replacing the hello-world page, Vercel deploy, Supabase database and schema (per-user from day one), login (Supabase Auth, allowlist), theme system, settings page skeleton, chess.com import, filtered puzzle store.
2. **Analysis:** Stockfish job, mistake tagging, weakness profiles; run the 12-month backlog. Milestone: the user can see their weakness profile from real games.
3. **Training:** puzzle board, the four modes, attempt logging, analysis board with optional engine, positional "find the move" drills. The Blindspot rating is calculated from this phase, because rising difficulty and adaptive selection need it; it isn't shown until Phase 4.
4. **Progress:** showing the Blindspot rating, Blitz gap, theme ratings, charts. (The daily import schedule was switched on early, in Phase 1.)
5. **AI explanations:** an on-demand Explain button after a puzzle and on the analysis board. Stockfish and code establish the facts (the line, what is attacked, what the move fixes); the AI only puts them into words and never judges the position itself. Positional weaknesses first. Cost controls: prepaid provider credits with auto top-up off (hard cap); an in-app monthly budget and daily limit set in settings; a usage panel showing explanations and estimated spend this month; each position's explanation cached so repeats are free; a small, cheap model by default.

**Later:** opening up to multiple users; mining unseen positional positions from Lichess games as a fairer test of positional training; possibly bringing back a choice of Rush length (3, 5 or 10 minutes), which needs a database change so each run records its length and the run stats compare like with like (the old `settings.rush_minutes` column is still there, unused).

**Out of scope:** random or free-choice puzzles, own-game positions outside the positional drills, a time-trouble category, app store release.
