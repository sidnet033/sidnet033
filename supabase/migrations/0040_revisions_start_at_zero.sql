-- A project's first revision is Rev 0 (then 1, 2, ...). create_revision
-- already numbers new ones as max + 1, so only the default and the
-- existing rows change.
alter table revisions alter column revision_number set default 0;
update revisions set revision_number = revision_number - 1;
