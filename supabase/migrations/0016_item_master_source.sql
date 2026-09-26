-- Every item must record whether it came from Design or Estimation.
-- Backfill existing rows before enforcing NOT NULL so the constraint can
-- actually be added.
alter table item_master add column source text;
update item_master set source = 'Estimation' where source is null;
alter table item_master
  alter column source set not null,
  add constraint item_master_source_check check (source in ('Design', 'Estimation'));
