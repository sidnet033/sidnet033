-- mrp_or_lp is a two-value label (MRP or LP), not a price amount -- fix the
-- column type before any real data gets written to it.
alter table item_master
  alter column mrp_or_lp drop default,
  alter column mrp_or_lp type text using null,
  add constraint item_master_mrp_or_lp_check check (mrp_or_lp is null or mrp_or_lp in ('MRP', 'LP'));
