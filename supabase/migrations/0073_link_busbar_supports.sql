-- ABB busbar supports priced from the workbook's Part Costs sub-parts (1:1).
insert into artuk_part_components (parent_sku, subpart_id, qty, sort_order)
select m.sku, s.id, 1, 1
  from (values
    ('551040-T1A INTL', 'Interleaved Bus bar Support for 4R without Neutral Arrangements'),
    ('551040-T1NFA', '100% Neutral BB Support -10mm,Stud-200mm'),
    ('551040-T2NHA', '50% Neutral BB Support -10mm,Stud-200mm'),
    ('MXM6514NS', 'Single Run Busbar Support 4pole 10mm'),
    ('MXM8224NS', 'Two Run Busbar Support 4pole 10mm')
  ) as m(sku, code)
  join artuk_subparts s on s.code = m.code
on conflict (parent_sku, subpart_id) do nothing;
