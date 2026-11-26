-- Blindspot: each weakness's trend in the user's games (Phase 4, SPEC.md -> "Progress and
-- headline metrics": the lagging indicator, showing whether training carries over).
--
-- One row per profile, day and weakness key, written by the daily analysis job. The first
-- run after this migration fills in the past with one point a week (src/lib/weakness-store.ts).
-- per_game is the share of winning chance the weakness costs per game (0-1), recency-weighted
-- with the profile's half-life and from games only (no puzzle results), so it can fall as the
-- user improves. score is the game score against the family (1 = average), kept for reference.

create table weakness_history (
  user_id      uuid not null references users(id) on delete cascade,
  profile_key  text not null,
  taken_on     date not null,
  key          text not null,
  per_game     real not null,
  score        real not null,
  mistakes     int  not null,
  games        int  not null,
  primary key (user_id, profile_key, taken_on, key)
);

-- Only the server-side key reads and writes it (0002 grants service_role access to new tables).
alter table weakness_history enable row level security;
