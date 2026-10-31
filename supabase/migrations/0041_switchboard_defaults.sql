-- Defaults for a new switchboard: ArTuK, Form 4b, IP42, bottom entry/exit,
-- 50% neutral. Existing switchboards keep their values.
alter table switchboards
  alter column std set default 'ArTuK',
  alter column form_of_separation set default 'Form 4b (Type 7)',
  alter column ip_rating set default '42',
  alter column cable_entry set default 'Bottom',
  alter column cable_exit set default 'Bottom',
  alter column neutral_size_pct set default 50;
