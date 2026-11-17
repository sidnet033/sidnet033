-- SH0370-1 (Form 3A bracket) and SH1030-1 (rear horiz. bus segregation, D=900)
-- each = 1 x the same-coded sub-part imported in 0070.
insert into artuk_part_components (parent_sku, subpart_id, qty, sort_order)
select code, id, 1, 1 from artuk_subparts where code in ('SH0370-1', 'SH1030-1')
on conflict (parent_sku, subpart_id) do nothing;
