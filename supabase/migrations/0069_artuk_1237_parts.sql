-- ArTuK enclosure parts missing from the app, from the fabrication-BOM
-- workbook's "Part Costs" / "Max Part Costs" tabs (29-05-2026_1 rev):
-- VC3012-1, SK8012-1 (1237-deep top/base sets), LF2012-1 / LF2012-1 SPECIAL
-- (1100-deep side panels), KN2668-1IN (E2.2 ACB kit), FH_E22809-1 (E2.2
-- segregation kit). Sheet slips fixed: TC/BC920/1237 are built 1230 deep
-- (sheet: 1030) and SC1237 at 2000mm height (sheet: 1800), as their names say.

insert into artuk_subparts (code, description, family, material, length_mm, width_mm, thickness_mm, qty_per, weight_fixed, punch, bending, fab, finish, punch_strokes, xls_cost, source, notes, unit_cost) values
  ('DP1237', '1237 MM Deep piece with 1.6mm GI', '9 fold Deep Piece', 'GI', 1100, 202, 1.5, 1, false, 'PUNCHING', true, false, null, 217, 274.72, 'Part Costs row 12', null, 0),
  ('TC420/1237', '420 MM TOP COVER FOR 1237', '9 fold Deep Piece', 'CRCA', 417, 1230, 2, 1, false, 'PUNCHING', true, false, 'PC', 36, 946.40, 'Part Costs row 13', null, 0),
  ('BC420/1237', '420 MM BOTTOM COVER FOR 1237', '9 fold Deep Piece', 'CRCA', 417, 1230, 2, 1, false, 'PUNCHING', true, false, 'PC', 36, 946.40, 'Part Costs row 14', null, 0),
  ('TC920/1237', '920 MM TOP COVER FOR 1237', '9 fold Deep Piece', 'CRCA', 917, 1230, 2, 1, false, 'PUNCHING', true, false, 'PC', 64, 1742.77, 'Part Costs row 33', 'Sheet lists 917x1030; built 1230 deep to match the 1237 depth.', 0),
  ('BC920/1237', '920 MM BOTTOM COVER FOR 1237', '9 fold Deep Piece', 'CRCA', 917, 1230, 2, 1, false, 'PUNCHING', true, false, 'PC', 64, 1742.77, 'Part Costs row 34', 'Sheet lists 917x1030; built 1230 deep to match the 1237 depth.', 0),
  ('SC1237', '1237MM DEPTH SIDE COVER FOR 2000MM HEIGHT', 'SIDE COVER', 'CRCA', 2071, 1193, 1.5, 1, false, 'LASER', true, false, 'PC', null, 3522.84, 'Part Costs row 465', 'Sheet lists 1871 long (1800mm height); built 2071 for the 2000mm side panel.', 0),
  ('SC1237/2mm', '1237MM DEPTH SIDE COVER FOR 2000MM HEIGHT', 'SIDE COVER FOR INTERNAL APC', 'CRCA', 2071, 1193, 2, 1, false, 'LASER', true, false, 'PC', null, 4791.58, 'Part Costs row 450', null, 0)
on conflict (code) do nothing;

insert into artuk_subparts (code, description, material, unit_cost, xls_cost, gasket_m, qty_per, weight_fixed, bending, fab, source) values
  ('GASKET FOR 420MM CUBICAL (2000H*420W*1237D)', 'GASKET FOR 420MM CUBICAL (2000H*420W*1237D)', 'BO', 210, 210, 1.5, 1, false, false, false, 'Max Part Costs (fixed price)'),
  ('GASKET FOR 920MM CUBICAL (2000H*920W*1237D)', 'GASKET FOR 920MM CUBICAL (2000H*920W*1237D)', 'BO', 590, 590, 4.214, 1, false, false, false, 'Max Part Costs (fixed price)'),
  ('GASKET FOR SIDE PANEL 2000x1100', 'GASKET FOR SIDE PANEL 2000x1100', 'BO', 1008, 1008, 7.2, 1, false, false, false, 'Max Part Costs (fixed price)')
on conflict (code) do nothing;

insert into item_master (sku, description, category, uom, unit_cost, status, source, make)
select 'LF2012-1 SPECIAL', 'N°2 side panels IP65,2000x1100(HxD)mm(Side Cover), 2mm (internal arc)', 'ArTuK Enclosure', 'nos', 0, 'active', 'Design', 'ABB'
where not exists (select 1 from item_master where sku = 'LF2012-1 SPECIAL');

insert into artuk_part_components (parent_sku, subpart_id, qty, sort_order)
select v.parent, s.id, v.qty, v.ord
from (values
  ('VC3012-1', 'CP420 - 0', 2, 0), ('VC3012-1', 'CP420 - 00', 2, 1), ('VC3012-1', 'DP1237', 4, 2),
  ('VC3012-1', 'TC420/1237', 1, 3), ('VC3012-1', 'BC420/1237', 1, 4),
  ('VC3012-1', 'GASKET FOR 420MM CUBICAL (2000H*420W*1237D)', 2, 5),
  ('SK8012-1', 'CP920 - 0', 2, 0), ('SK8012-1', 'CP920 - 00', 2, 1), ('SK8012-1', 'DP1237', 4, 2),
  ('SK8012-1', 'TC920/1237', 1, 3), ('SK8012-1', 'BC920/1237', 1, 4),
  ('SK8012-1', 'GASKET FOR 920MM CUBICAL (2000H*920W*1237D)', 2, 5),
  ('LF2012-1', 'SC1237', 1, 0), ('LF2012-1', 'GASKET FOR SIDE PANEL 2000x1100', 1, 1), ('LF2012-1', 'Combi with Shoulder Screw', 8, 2),
  ('LF2012-1 SPECIAL', 'SC1237/2mm', 1, 0), ('LF2012-1 SPECIAL', 'GASKET FOR SIDE PANEL 2000x1100', 1, 1), ('LF2012-1 SPECIAL', 'Combi with Shoulder Screw', 8, 2),
  ('KN2668-1IN', 'ACB KIT 720MM-1', 1, 0), ('KN2668-1IN', 'ACB KIT 720MM-2', 2, 1), ('KN2668-1IN', 'ACB KIT 720MM-3', 1, 2),
  ('KN2668-1IN', 'ACB KIT 720MM-4', 1, 3), ('KN2668-1IN', 'ACB KIT 720MM-5', 1, 4), ('KN2668-1IN', 'ACB KIT 720MM-6', 1, 5),
  ('FH_E22809-1', 'Sagregation Kit for 920', 1, 0), ('FH_E22809-1', '4mm THK Polycarbonate Sheet #2', 1, 1)
) as v(parent, code, qty, ord)
join artuk_subparts s on s.code = v.code
on conflict (parent_sku, subpart_id) do nothing;
