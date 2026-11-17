-- 1320 bay shelf (SH1100/2-1, W=1200mm) = 1 x 1320MM HRP, like SH6000/SH8000/SH1100-1.
insert into artuk_part_components (parent_sku, subpart_id, qty, sort_order)
select 'SH1100/2-1', id, 1, 1 from artuk_subparts where code = '1320MM HRP'
on conflict (parent_sku, subpart_id) do nothing;
