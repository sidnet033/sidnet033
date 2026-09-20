-- BOM Builder: once a user edits a feeder line's list price or discount %
-- directly in a switchboard's BOM, that edit must stick even if Item
-- Master's price changes later. Store the override on the feeder_items
-- row itself (qty already works the same way) rather than re-deriving it
-- from item_master on every load.

alter table feeder_items
  add column list_price_override numeric,
  add column discount_pct_override numeric;
