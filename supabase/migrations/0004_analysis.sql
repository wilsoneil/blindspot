-- Blindspot: Phase 2 (analysis).
--
-- How to apply: Supabase dashboard -> SQL Editor -> paste this file -> Run.
-- Adds the analysis results for each game, the mistakes found in them and the weakness
-- profiles. All of it is personal data: it lives only here, never in the repo.

-- ---------------------------------------------------------------------------
-- What the analysis learned about each game (analysed_at already exists).
-- ---------------------------------------------------------------------------
alter table games
  add column analysis_version   int,     -- which version of the method analysed it (src/lib/analysis/eval.ts)
  add column situations         text[],  -- labels whose situation arose at one of the user's moves
  add column opening_family     text,    -- White: opening family; Black: White's first move
  add column opening_variation  text,    -- White: variation; Black: White's first move + the user's reply
  add column analysis_error     text;    -- set instead of analysed_at if the game couldn't be read

-- ---------------------------------------------------------------------------
-- Mistakes: one row per costly move by the user. Also the "find the move" positions
-- for the positional drills in Phase 3.
-- ---------------------------------------------------------------------------
create table mistakes (
  id                bigint generated always as identity primary key,
  user_id           uuid   not null references users(id) on delete cascade,
  game_id           bigint not null references games(id) on delete cascade,
  time_control      text   not null,          -- copied from the game, for filtering
  time_class        text   not null,
  played_at         timestamptz not null,
  ply               int    not null,          -- 0 = White's first move
  move_number       int    not null,
  fen               text   not null,          -- position before the user's move
  played_uci        text   not null,
  played_san        text   not null,
  best_uci          text   not null,
  best_san          text   not null,
  eval_before_cp    int,                      -- from the user's side; a forced mate fills *_mate instead
  eval_before_mate  int,
  eval_after_cp     int,
  eval_after_mate   int,
  win_chance_drop   real   not null,          -- 0..1: 0.25 = threw away 25 points of winning chance
  phase             text   not null,
  labels            text[] not null,          -- weakness label keys, e.g. 'fork:allowed', 'phaseTransition'
  best_line         text   not null,          -- engine's best line from the position, UCI
  refutation        text   not null,          -- engine's best reply to the move played, UCI
  unique (game_id, ply)
);
create index mistakes_user_played on mistakes (user_id, played_at desc);
create index mistakes_labels on mistakes using gin (labels);

-- ---------------------------------------------------------------------------
-- Weakness profiles: one per user and time control ('300', '180+2', ... or 'daily').
-- Rebuilt by the daily job and whenever a scoring setting changes.
-- ---------------------------------------------------------------------------
create table weakness_profiles (
  user_id         uuid not null references users(id) on delete cascade,
  profile_key     text not null,
  computed_at     timestamptz not null default now(),
  games_analysed  int  not null,
  mistakes        int  not null,
  top             jsonb not null,             -- the top list, worst first
  entries         jsonb not null,             -- every category that passed the evidence rule
  primary key (user_id, profile_key)
);

create index games_to_analyse on games (user_id, played_at desc) where analysed_at is null;

-- Same lock-down as the other tables: only the server-side key can reach them
-- (0002 already grants it access to new tables).
alter table mistakes          enable row level security;
alter table weakness_profiles enable row level security;
