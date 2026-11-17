-- ISMC channel rate for base frames: base frame cost per bay =
-- 2 x (width + depth) [m] x ISMC weight (9.56 kg/m for ISMC 100, 7.8 for
-- ISMC 75) x this rate. Set it in the Enclosure Rates Master.
insert into enclosure_rates (key, label, unit, rate, sort_order)
values ('ISMC', 'ISMC (base frame)', 'INR/kg', 0, 11)
on conflict (key) do nothing;
