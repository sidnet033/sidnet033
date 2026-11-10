-- ArTuK vertical (bay) parts lists, moved from code into the database so
-- admins can add / remove parts. One row per bay type (workbook tab) and one
-- per part line. Everyone reads; only admins write.
create table if not exists artuk_bay_templates (
  key text primary key,
  title text not null,
  widths_mm int[] not null,
  depth_mm int not null,
  kind text not null check (kind in ('acb','acb_bc','acb_2tier','mcc','mcc_front','mcc_df','any')),
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists artuk_bay_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_key text not null references artuk_bay_templates(key) on delete cascade on update cascade,
  section text not null check (section in ('vertical','panel','arc_vertical','arc_panel')),
  code text not null,
  description text not null default '',
  scope text,
  qty numeric not null check (qty > 0),
  unit_cost numeric,
  replaces text,
  sort_order int not null default 0
);
create index if not exists artuk_bay_template_lines_key on artuk_bay_template_lines (template_key, section, sort_order);

alter table artuk_bay_templates enable row level security;
alter table artuk_bay_template_lines enable row level security;
drop policy if exists "bay templates read" on artuk_bay_templates;
create policy "bay templates read" on artuk_bay_templates for select to authenticated using (true);
drop policy if exists "bay templates admin write" on artuk_bay_templates;
create policy "bay templates admin write" on artuk_bay_templates for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "bay template lines read" on artuk_bay_template_lines;
create policy "bay template lines read" on artuk_bay_template_lines for select to authenticated using (true);
drop policy if exists "bay template lines admin write" on artuk_bay_template_lines;
create policy "bay template lines admin write" on artuk_bay_template_lines for all to authenticated using (is_admin()) with check (is_admin());
