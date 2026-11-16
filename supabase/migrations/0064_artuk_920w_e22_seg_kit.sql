-- Revised workbook (29-05-2026_1): the 920W E2.2 vertical takes the E2.2
-- segregation kit (FH_E22809-1), not the E4.2 one.
update artuk_bay_template_lines
set code = 'FH_E22809-1', description = 'Segg Kit Emax E2.2 ,800x900(WxD)mm'
where template_key = '920W E2.2' and section = 'vertical' and code = 'FH_E42809-1';
