import type { SupabaseClient } from "@supabase/supabase-js";

// Enclosure steel rates (INR/kg). The app-wide defaults live in app_settings
// (admin-editable); a project's own rate, when set, overrides them. A blank
// (null) project rate means "use the default".
export type SteelRates = { GI: number; CRCA: number };
export const FALLBACK_STEEL_RATES: SteelRates = { GI: 90, CRCA: 71 };

export async function getDefaultSteelRates(
  supabase: SupabaseClient,
): Promise<SteelRates> {
  const { data } = await supabase
    .from("app_settings")
    .select("enclosure_rate_gi, enclosure_rate_crca")
    .eq("id", true)
    .maybeSingle();
  if (!data) return FALLBACK_STEEL_RATES;
  return {
    GI: Number(data.enclosure_rate_gi),
    CRCA: Number(data.enclosure_rate_crca),
  };
}

export function effectiveSteelRates(
  project: {
    enclosure_rate_gi: number | null;
    enclosure_rate_crca: number | null;
  } | null,
  defaults: SteelRates,
): SteelRates {
  return {
    GI:
      project?.enclosure_rate_gi != null
        ? Number(project.enclosure_rate_gi)
        : defaults.GI,
    CRCA:
      project?.enclosure_rate_crca != null
        ? Number(project.enclosure_rate_crca)
        : defaults.CRCA,
  };
}

// One ArTuK sub-part's cost: GI / CRCA with a weight = weight x rate; anything
// else (bought-out, or steel with no weight on file) its own unit cost.
export function subpartCost(
  p: { material: string | null; weight_kg: number | null; unit_cost: number },
  rates: SteelRates,
): number {
  const w = p.weight_kg != null ? Number(p.weight_kg) : 0;
  if (p.material === "GI" && w > 0) return w * rates.GI;
  if (p.material === "CRCA" && w > 0) return w * rates.CRCA;
  return Number(p.unit_cost ?? 0);
}
