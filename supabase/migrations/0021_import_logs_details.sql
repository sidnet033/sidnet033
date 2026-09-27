-- Flexible per-source-type stats for import_logs, so a source that needs
-- more than created/updated/failed counts (e.g. feeder import's "feeders
-- extended" / "lines added" figures) doesn't have to overload those
-- generic columns with a different meaning per source.
alter table import_logs add column details jsonb not null default '{}'::jsonb;
