-- Position of a bay's leftover blank/DUMMY space within its feeder stack.
-- Null means "after every placed feeder" (today's default, unmoved).
alter table verticals add column dummy_slot integer;
