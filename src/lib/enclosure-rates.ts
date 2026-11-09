import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtukSubpart } from "@/types/database";

// Enclosure Rates Master: app-level rates (enclosure_rates, admin-editable)
// with optional per-project overrides (project_enclosure_rates).
export type RateKey =
  | "CRCA"
  | "GI"
  | "LASER"
  | "PUNCHING"
  | "BENDING"
  | "FABRICATION"
  | "POWDER_COATING"
  | "PUNCHING_STROKE"
  | "GASKET_M"
  | "PLATING";
export type EnclosureRateRow = {
  key: RateKey;
  label: string;
  unit: string;
  rate: number;
  sort_order: number;
};
export type Rates = Record<RateKey, number>;

export const FALLBACK_RATES: Rates = {
  CRCA: 71,
  GI: 90,
  LASER: 14,
  PUNCHING: 8,
  BENDING: 7,
  FABRICATION: 3,
  POWDER_COATING: 23,
  PUNCHING_STROKE: 0.5,
  GASKET_M: 140,
  PLATING: 28,
};

export async function loadRateMaster(
  supabase: SupabaseClient,
): Promise<EnclosureRateRow[]> {
  const { data } = await supabase
    .from("enclosure_rates")
    .select("key, label, unit, rate, sort_order")
    .order("sort_order");
  return ((data ?? []) as EnclosureRateRow[]).map((r) => ({
    ...r,
    rate: Number(r.rate),
  }));
}

export async function loadProjectOverrides(
  supabase: SupabaseClient,
  projectId: string,
): Promise<Partial<Rates>> {
  const { data } = await supabase
    .from("project_enclosure_rates")
    .select("key, rate")
    .eq("project_id", projectId);
  const out: Partial<Rates> = {};
  for (const r of (data ?? []) as { key: RateKey; rate: number }[])
    out[r.key] = Number(r.rate);
  return out;
}

export function ratesFrom(
  master: EnclosureRateRow[],
  overrides: Partial<Rates> = {},
): Rates {
  const r: Rates = { ...FALLBACK_RATES };
  for (const m of master) r[m.key] = m.rate;
  return { ...r, ...overrides };
}

// "Total Cost with KG calculation" for one sub-part (mirrors the database
// function artuk_subpart_cost_at):
//   M = Total Wt., N = PC area (sq ft, both sides)
//   Punching/kg = M x PUNCHING|LASER, Bending = M x BENDING, Fab = M x FABRICATION,
//   PC = N x POWDER_COATING (or M x PLATING), Material = M x GI|CRCA.
// Gaskets = length (m) x GASKET_M; other bought-out parts their own cost.
export type CostBreakdown = {
  punch: number;
  bending: number;
  fab: number;
  pc: number;
  material: number;
  total: number;
};
export function subpartBreakdown(
  sp: Pick<
    ArtukSubpart,
    | "material"
    | "weight_kg"
    | "pc_area_sqft"
    | "punch"
    | "bending"
    | "fab"
    | "finish"
    | "gasket_m"
    | "unit_cost"
  >,
  r: Rates,
): CostBreakdown {
  const m = Number(sp.weight_kg ?? 0);
  if ((sp.material === "GI" || sp.material === "CRCA") && m > 0) {
    const punch = sp.punch ? m * r[sp.punch] : 0;
    const bending = sp.bending ? m * r.BENDING : 0;
    const fab = sp.fab ? m * r.FABRICATION : 0;
    const pc =
      sp.finish === "PC"
        ? Number(sp.pc_area_sqft ?? 0) * r.POWDER_COATING
        : sp.finish === "PLATING"
          ? m * r.PLATING
          : 0;
    const material = m * r[sp.material];
    return {
      punch,
      bending,
      fab,
      pc,
      material,
      total: punch + bending + fab + pc + material,
    };
  }
  const total =
    sp.gasket_m != null
      ? Number(sp.gasket_m) * r.GASKET_M
      : Number(sp.unit_cost ?? 0);
  return { punch: 0, bending: 0, fab: 0, pc: 0, material: 0, total };
}
