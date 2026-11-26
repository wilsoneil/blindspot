-- Blindspot: the Blitz gap, worked out once a day by the import job instead of on every
-- home page visit (it reads every imported game's rating). One row per user; data is the
-- finished series and figures (src/lib/progress/blitz-gap.ts), or null while the user has
-- no Daily and Blitz ratings yet.

create table blitz_gaps (
  user_id      uuid primary key references users(id) on delete cascade,
  computed_at  timestamptz not null default now(),
  data         jsonb
);

-- Only the server-side key reads and writes it (0002 grants service_role access to new tables).
alter table blitz_gaps enable row level security;
