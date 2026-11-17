-- Free-text remarks for the BOM Builder busbar section (e.g. the busbar list
-- from an imported PK2025 BOM).
alter table switchboards add column if not exists busbar_remarks text;
