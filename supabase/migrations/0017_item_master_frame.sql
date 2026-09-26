-- Optional "frame" field on item_master, relevant to ACBs/MCCBs/MCBs
-- (e.g. "630AF", "100A Frame") -- meaningless for most other item
-- categories, so it stays nullable rather than required.
alter table item_master add column frame text;
