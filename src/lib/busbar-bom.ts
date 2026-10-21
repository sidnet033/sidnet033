import type { SupabaseClient } from "@supabase/supabase-js";
import type { Feeder, PlacedFeeder, Switchboard, Vertical } from "@/types/database";
import { MATERIAL_DENSITY, barArea, type BarSize, type BusbarMaterial, type BusbarPlan } from "@/lib/busbar-plan";
import {
  BUSBAR_CHAMBER_HEIGHT_MM,
  effectivePanelHeight,
  overridesFromRows,
  planForSwitchboard,
  type BusbarOverrideRow,
} from "@/lib/ga-layout";

// The BOM's busbar lines, computed from the GA's busbar plan: one line per
// stocked bar size, quantity in kg (phase + neutral, every run), priced at
// the project's per-kg rate for the switchboard's material. Computed live,
// never stored, so the BOM and costing always match the current GA and
// project settings.

export type BusbarBomLine = {
  key: string;
  material: BusbarMaterial;
  bar: BarSize;
  lengthM: number;
  kg: number;
  rate: number;
  amount: number;
  description: string;
};

export type BusbarTakeoff = {
  lines: BusbarBomLine[];
  material: BusbarMaterial;
  ratePerKg: number;
  total: number;
  // true when the board has busbar but the project has no rate for its material
  rateMissing: boolean;
};

// rates: INR/kg per material. ABB's 5000A aluminium chart uses copper phase
// links, so an Al board can carry a copper line.
export function busbarTakeoff(plan: BusbarPlan, material: BusbarMaterial, rates: Record<BusbarMaterial, number>): BusbarTakeoff {
  const ratePerKg = rates[material];
  const bySize = new Map<string, { bar: BarSize; lengthMm: number; material: BusbarMaterial }>();
  const add = (bar: BarSize, bars: number, lengthMm: number, mat: BusbarMaterial = material) => {
    const key = `${mat}-${bar.widthMm}x${bar.thicknessMm}`;
    const entry = bySize.get(key) ?? { bar, lengthMm: 0, material: mat };
    entry.lengthMm += bars * lengthMm;
    bySize.set(key, entry);
  };
  for (const seg of plan.segments) {
    // ArTuK ABB-chart bars: lengths per size and material (all phases + neutral)
    if (seg.pieces) {
      for (const pc of seg.pieces) add(pc.bar, 1, pc.lengthMm, pc.material);
      continue;
    }
    if (!seg.bar || seg.lengthMm <= 0) continue;
    add(seg.bar, seg.runs * 3, seg.lengthMm);
    if (seg.neutral) add(seg.neutral.bar, seg.neutral.runs, seg.lengthMm);
  }
  const lines = [...bySize.entries()]
    .sort((a, b) => barArea(b[1].bar) - barArea(a[1].bar))
    .map(([key, { bar, lengthMm, material: mat }]) => {
      const kg = Math.round(barArea(bar) * lengthMm * MATERIAL_DENSITY[mat] * 10) / 10;
      const lengthM = Math.round(lengthMm / 100) / 10;
      return {
        key,
        material: mat,
        bar,
        lengthM,
        kg,
        rate: rates[mat],
        amount: kg * rates[mat],
        description: `${mat === "Cu" ? "Copper" : "Aluminium"} busbar ${bar.widthMm}×${bar.thicknessMm} mm — ${lengthM} m`,
      };
    });
  return {
    lines,
    material,
    ratePerKg,
    total: lines.reduce((s, l) => s + l.amount, 0),
    rateMissing: lines.some((l) => l.rate <= 0),
  };
}

type ProjectBusbarSettings = { busbar_density_cu: number; busbar_density_al: number; busbar_rate_cu: number; busbar_rate_al: number };

// Loads what the plan needs (bays, placed feeders, overrides, project
// densities/rates) and returns the busbar takeoff for one switchboard.
// Works with both the browser and server Supabase clients.
export async function loadBusbarTakeoff(supabase: SupabaseClient, sb: Switchboard): Promise<BusbarTakeoff> {
  const [{ data: vRows }, { data: oRows }, { data: rev }] = await Promise.all([
    supabase.from("verticals").select("*").eq("switchboard_id", sb.id).order("sort_order"),
    supabase.from("busbar_overrides").select("*").eq("switchboard_id", sb.id),
    supabase
      .from("revisions")
      .select("project:projects(busbar_density_cu, busbar_density_al, busbar_rate_cu, busbar_rate_al)")
      .eq("id", sb.revision_id)
      .single(),
  ]);
  const verticals = (vRows ?? []) as Vertical[];
  const vIds = verticals.map((v) => v.id);
  const { data: pRows } = vIds.length
    ? await supabase.from("placed_feeders").select("*, feeder:feeders(*)").in("vertical_id", vIds).order("sort_order")
    : { data: [] };
  const placed = (pRows ?? []) as unknown as (PlacedFeeder & { feeder: Feeder })[];
  const project = (rev as unknown as { project: ProjectBusbarSettings | null } | null)?.project ?? null;
  const material: BusbarMaterial = sb.busbar ?? "Cu";

  const plan = planForSwitchboard({
    params: sb,
    verticals: verticals.map((v) => ({ ...v, placed: placed.filter((p) => p.vertical_id === v.id) })),
    overrides: overridesFromRows((oRows ?? []) as BusbarOverrideRow[]),
    densities: { Cu: Number(project?.busbar_density_cu ?? 1.6), Al: Number(project?.busbar_density_al ?? 1.0) },
    panelHeightMm: effectivePanelHeight(sb),
    chamberHeightMm: sb.busbar_chamber_height_mm ?? BUSBAR_CHAMBER_HEIGHT_MM,
  });
  return busbarTakeoff(plan, material, { Cu: Number(project?.busbar_rate_cu ?? 0), Al: Number(project?.busbar_rate_al ?? 0) });
}
