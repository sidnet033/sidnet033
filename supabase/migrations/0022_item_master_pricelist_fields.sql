alter table item_master
  add column pricelisted boolean not null default false,
  add column mrp_or_lp numeric,
  add column hsn_code text,
  add column vendor_description text;
