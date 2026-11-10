import type { SupabaseClient } from "@supabase/supabase-js";

// ArTuK vertical parts lists, one per bay type, seeded from the fabrication
// BOM workbook (one tab per vertical) and kept in the database
// (artuk_bay_templates / artuk_bay_template_lines) so admins can add and
// remove parts from the Enclosure Rates Master -> bay configs dialog.
//
// Sections:
//   vertical      parts for one vertical of this type (for a paired type,
//                 e.g. 920+720 2-tier, the whole pair)
//   panel         once per entire panel (side panels)
//   arc_vertical  internal arc, per vertical: replaces `replaces` (e.g. the
//                 1.5mm glass door with the 2mm one) or, with no `replaces`,
//                 is added (arc-plasma spacers)
//   arc_panel     internal arc, once per panel (2mm side panels)
// unitCost is the workbook's cost, used only when the part isn't in Item
// Master.

export type ArtukTemplateKind =
  | "acb" // ACB incomer / outgoing
  | "acb_bc" // ACB bus coupler with internal bus riser
  | "acb_2tier" // two ACBs stacked per vertical
  | "mcc" // MCCB vertical, rear access
  | "mcc_front" // MCCB pair, front access
  | "mcc_df" // MCCB pair, double front
  | "any"; // matched on width alone (420 bus-coupler riser, 510 standalone)

export type ArtukTemplateLine = {
  id?: string;
  section: "vertical" | "panel" | "arc_vertical" | "arc_panel";
  code: string;
  description: string;
  scope: string | null;
  qty: number;
  unitCost: number | null;
  replaces?: string | null;
};

export type ArtukBayTemplate = {
  key: string; // workbook tab
  title: string;
  /** bay widths left to right; two for a paired type */
  widthsMm: number[];
  depthMm: number;
  kind: ArtukTemplateKind;
  lines: ArtukTemplateLine[];
};

type TemplateRow = {
  key: string;
  title: string;
  widths_mm: number[];
  depth_mm: number;
  kind: ArtukTemplateKind;
  sort_order: number;
};
type LineRow = {
  id: string;
  template_key: string;
  section: ArtukTemplateLine["section"];
  code: string;
  description: string;
  scope: string | null;
  qty: number;
  unit_cost: number | null;
  replaces: string | null;
  sort_order: number;
};

export async function loadBayTemplates(
  supabase: SupabaseClient,
): Promise<ArtukBayTemplate[]> {
  const [{ data: tRows, error: te }, { data: lRows, error: le }] =
    await Promise.all([
      supabase.from("artuk_bay_templates").select("*").order("sort_order"),
      supabase
        .from("artuk_bay_template_lines")
        .select("*")
        .order("sort_order")
        .range(0, 9999),
    ]);
  if (te) throw te;
  if (le) throw le;
  const byKey = new Map<string, ArtukTemplateLine[]>();
  for (const l of (lRows ?? []) as LineRow[]) {
    const arr = byKey.get(l.template_key) ?? [];
    arr.push({
      id: l.id,
      section: l.section,
      code: l.code,
      description: l.description,
      scope: l.scope,
      qty: Number(l.qty),
      unitCost: l.unit_cost == null ? null : Number(l.unit_cost),
      replaces: l.replaces,
    });
    byKey.set(l.template_key, arr);
  }
  return ((tRows ?? []) as TemplateRow[]).map((t) => ({
    key: t.key,
    title: t.title,
    widthsMm: t.widths_mm,
    depthMm: t.depth_mm,
    kind: t.kind,
    lines: byKey.get(t.key) ?? [],
  }));
}

/** a section's lines, with the internal-arc parts swapped / added in */
export function withArc(
  lines: ArtukTemplateLine[],
  section: "vertical" | "panel",
  internalArc: boolean,
): ArtukTemplateLine[] {
  const base = lines.filter((l) => l.section === section);
  if (!internalArc) return base;
  const arc = lines.filter((l) => l.section === `arc_${section}`);
  const replaced = new Set(arc.map((l) => l.replaces).filter(Boolean));
  return [...base.filter((l) => !replaced.has(l.code)), ...arc];
}
