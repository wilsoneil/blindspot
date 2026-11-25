-- Blindspot: Phase 3, steps 10 and 11 ("find the move" positions from the user's own games,
-- and finding puzzles by opening).
--
-- How to apply: Supabase dashboard -> SQL Editor -> paste this file -> Run.
-- Adds, for each stored mistake, the moves accepted as answers when the position is
-- trained, and how subtle it is. Filled by scripts/find-moves.ts (run after each daily
-- analysis, or by hand: Actions -> "Analyse games").

alter table mistakes
  add column accepted_moves     text[],  -- UCI; null = not worked out yet
  add column subtlety           real,    -- 0 (many good moves) .. 1 (one move, the rest lose badly)
  add column positions_version  int;     -- which version of the method (src/lib/analysis/accepted.ts)

create index mistakes_positions_todo on mistakes (user_id) where accepted_moves is null;

-- Step 11: opening weaknesses are trained with puzzles found by their Lichess OpeningTags.
create index puzzles_opening_tags on puzzles using gin (opening_tags);
