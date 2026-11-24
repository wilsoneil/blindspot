-- Blindspot: Phase 1 schema (foundations).
--
-- How to apply: Supabase dashboard -> SQL Editor -> paste this file -> Run.
-- Later phases add new numbered files (0002_..., 0003_...) instead of editing this one.
--
-- Security model for v1 (no logins yet):
--   Row Level Security (RLS) is switched ON for every table and no policies are added.
--   That means the public "anon" key can read or write nothing. Only the server-side
--   "service role" key (kept in Vercel / GitHub settings, never in code) can reach the data.
--   When real logins arrive, per-user policies are added here.

-- ---------------------------------------------------------------------------
-- Users. v1 has exactly one row; every personal table points at it.
-- ---------------------------------------------------------------------------
create table users (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Settings: one row per user. Defaults match the Settings table in SPEC.md.
-- ---------------------------------------------------------------------------
create table settings (
  user_id               uuid primary key references users(id) on delete cascade,
  chesscom_username     text,                                   -- set on first run
  focus_time_control    text    not null default '300',         -- chess.com time_control; '300' = 5-minute blitz
  weaknesses_shown      int     not null default 5   check (weaknesses_shown between 3 and 8),
  games_weight_pct      int     not null default 70  check (games_weight_pct between 0 and 100),
  half_life_days        int     not null default 60  check (half_life_days between 14 and 365),
  history_months        int              default 12  check (history_months is null or history_months >= 3), -- null = all games
  target_time           text    not null default 'normal' check (target_time in ('stricter', 'normal', 'looser')),
  rush_minutes          int     not null default 5   check (rush_minutes in (3, 5, 10)),
  survival_lives        int     not null default 3   check (survival_lives between 1 and 5),
  engine_on_board       boolean not null default false,
  theme                 text    not null default 'slate',
  ai_enabled            boolean not null default true,
  ai_monthly_budget_gbp numeric(8,2) not null default 5.00 check (ai_monthly_budget_gbp >= 0),
  ai_daily_limit        int     not null default 20  check (ai_daily_limit >= 0),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Games imported from chess.com. Personal data: lives only here, never in the repo.
-- ---------------------------------------------------------------------------
create table games (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references users(id) on delete cascade,
  source           text not null default 'chesscom',
  source_game_id   text not null,                 -- chess.com game URL id
  url              text,
  played_at        timestamptz not null,          -- game end time
  time_class       text not null,                 -- bullet / blitz / rapid / daily
  time_control     text not null,                 -- e.g. '300', '180+2', '1/86400'
  rated            boolean not null,
  colour           text not null check (colour in ('white', 'black')),
  user_rating      int,
  opponent_rating  int,
  result           text not null check (result in ('win', 'loss', 'draw')),
  result_detail    text,                          -- resigned, timeout, checkmated, agreed, ...
  eco              text,                          -- e.g. 'B90'
  opening_name     text,                          -- from chess.com's opening link
  pgn              text not null,
  clocks           int[],                         -- clock after each move, in tenths of a second
  analysed_at      timestamptz,                   -- set by the Phase 2 analysis job
  imported_at      timestamptz not null default now(),
  unique (user_id, source, source_game_id)
);
create index games_user_tc_played on games (user_id, time_control, played_at desc);

-- Which monthly chess.com archives have been fully imported (past months never change).
create table archive_imports (
  user_id      uuid not null references users(id) on delete cascade,
  archive_url  text not null,
  game_count   int  not null,
  complete     boolean not null,                 -- false for the current, still-growing month
  fetched_at   timestamptz not null default now(),
  primary key (user_id, archive_url)
);

-- Daily chess.com ratings, used for the Blitz gap in Phase 4.
create table rating_snapshots (
  user_id     uuid not null references users(id) on delete cascade,
  taken_on    date not null,
  time_class  text not null,                     -- blitz / daily / rapid / bullet
  rating      int  not null,
  primary key (user_id, taken_on, time_class)
);

-- ---------------------------------------------------------------------------
-- Puzzle store: a filtered copy of the Lichess puzzle database (CC0).
-- Shared reference data, so no user_id. Filled by scripts/build-puzzles.ts.
-- ---------------------------------------------------------------------------
create table puzzles (
  id                text primary key,            -- Lichess puzzle id
  fen               text not null,
  moves             text not null,               -- UCI moves, space separated
  rating            int  not null,
  rating_deviation  int  not null,
  popularity        int  not null,
  nb_plays          int  not null,
  themes            text[] not null,             -- raw Lichess themes
  opening_tags      text[] not null default '{}',
  labels            text[] not null              -- Blindspot weakness labels (src/lib/labels.ts)
);
create index puzzles_labels on puzzles using gin (labels);
create index puzzles_rating on puzzles (rating);

-- ---------------------------------------------------------------------------
-- Lock everything down (see note at the top).
-- ---------------------------------------------------------------------------
alter table users            enable row level security;
alter table settings         enable row level security;
alter table games            enable row level security;
alter table archive_imports  enable row level security;
alter table rating_snapshots enable row level security;
alter table puzzles          enable row level security;
