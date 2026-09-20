-- Feeder Master workspace: structured attributes (rated current, pole
-- config, breaking capacity) to match the mockup's "Feeder Attributes"
-- form, and a sort_order on feeder line items for the reorder arrows.

alter table feeders
  add column rated_current numeric,
  add column pole_config text,
  add column breaking_capacity text;

alter table feeder_items
  add column sort_order int not null default 0;
