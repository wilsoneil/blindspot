-- Blindspot: Phase 3 (training).
--
-- How to apply: Supabase dashboard -> SQL Editor -> paste this file -> Run.
-- Apply it before the next puzzle build: the build now checks puzzle_attempts so it
-- never removes a puzzle that has been attempted.
-- Adds training sessions, every puzzle attempt and the spaced-repetition queue.
-- All of it is personal data: it lives only here, never in the repo.

-- ---------------------------------------------------------------------------
-- Training sessions: one row per Drill, Rush, Survival or Blindspot session.
-- ---------------------------------------------------------------------------
create table training_sessions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references users(id) on delete cascade,
  mode          text not null check (mode in ('drill', 'rush', 'survival', 'blindspot')),
  profile_key   text not null,               -- time control whose profile chose the puzzles
  weakness_key  text,                        -- Drill only: the weakness trained (a label or a pair)
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  attempted     int not null default 0,
  solved        int not null default 0       -- correct within target time
);
create index training_sessions_user on training_sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Attempts: one row per puzzle played. A Lichess puzzle (puzzle_id) or a
-- "find the move" position from the user's own games (mistake_id), never both.
-- puzzle_id has no cascade on purpose: an attempted puzzle can't be deleted.
-- ---------------------------------------------------------------------------
create table puzzle_attempts (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references users(id) on delete cascade,
  session_id     bigint references training_sessions(id) on delete set null,
  mode           text not null check (mode in ('drill', 'rush', 'survival', 'blindspot')),
  puzzle_id      text references puzzles(id),
  mistake_id     bigint references mistakes(id) on delete cascade,
  labels         text[] not null,            -- the position's labels at the time
  puzzle_rating  int,                        -- Lichess rating at the time; null for own-game positions
  first_attempt  boolean not null,           -- only first attempts count towards ratings
  correct        boolean not null,           -- solved without a wrong move or a reveal
  solve_ms       int not null check (solve_ms >= 0),
  target_ms      int not null check (target_ms > 0),
  retries        int not null default 0 check (retries >= 0),
  revealed       boolean not null default false,
  attempted_at   timestamptz not null default now(),
  check ((puzzle_id is null) <> (mistake_id is null)),
  check (puzzle_id is null or puzzle_rating is not null)
);
create index puzzle_attempts_user on puzzle_attempts (user_id, attempted_at desc);
create index puzzle_attempts_puzzle on puzzle_attempts (puzzle_id) where puzzle_id is not null;
-- The first-attempt rule, enforced by the database: at most one per user and position.
create unique index puzzle_attempts_first_puzzle  on puzzle_attempts (user_id, puzzle_id)  where first_attempt and puzzle_id is not null;
create unique index puzzle_attempts_first_mistake on puzzle_attempts (user_id, mistake_id) where first_attempt and mistake_id is not null;

-- ---------------------------------------------------------------------------
-- Review queue: failed or slow positions coming back in Blindspot sessions
-- (due after 1, 3, 7, then 21 days; see "Training modes" in SPEC.md).
-- ---------------------------------------------------------------------------
create table review_queue (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references users(id) on delete cascade,
  puzzle_id   text references puzzles(id),
  mistake_id  bigint references mistakes(id) on delete cascade,
  step        int not null default 0 check (step between 0 and 3),  -- 0 = 1 day, 1 = 3, 2 = 7, 3 = 21
  due_at      timestamptz not null,
  updated_at  timestamptz not null default now(),
  check ((puzzle_id is null) <> (mistake_id is null))
);
create unique index review_queue_puzzle  on review_queue (user_id, puzzle_id)  where puzzle_id is not null;
create unique index review_queue_mistake on review_queue (user_id, mistake_id) where mistake_id is not null;
create index review_queue_due on review_queue (user_id, due_at);

-- Same lock-down as the other tables: only the server-side key can reach them
-- (0002 already grants it access to new tables).
alter table training_sessions enable row level security;
alter table puzzle_attempts   enable row level security;
alter table review_queue      enable row level security;
