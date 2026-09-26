-- Real, editable height for the main horizontal busbar chamber shown in
-- GA Builder (previously a hardcoded 100mm placeholder used only for
-- drawing proportions). Nullable -- GA Builder falls back to 100mm when unset.
alter table switchboards add column busbar_chamber_height_mm integer;
