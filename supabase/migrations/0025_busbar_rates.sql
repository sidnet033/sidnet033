-- Busbar copper/aluminium price per kg, set per project (commodity prices
-- move, and each quote is priced at its own rate). The BOM's busbar lines
-- are computed from the GA's busbar plan × these rates; 0 = not set yet.
alter table projects
  add column busbar_rate_cu numeric not null default 0 check (busbar_rate_cu >= 0),
  add column busbar_rate_al numeric not null default 0 check (busbar_rate_al >= 0);
