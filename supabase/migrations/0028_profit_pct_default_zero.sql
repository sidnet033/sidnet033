-- New switchboards start with no profit margin, so one that hasn't been
-- priced yet is flagged in Project Detail's warnings instead of silently
-- carrying 15%. Existing switchboards keep whatever they have.
alter table switchboards alter column profit_pct set default 0;
