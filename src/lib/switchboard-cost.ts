import type { SupabaseClient } from "@supabase/supabase-js";
import { getFeederCosts } from "@/lib/feeder-cost";
import type { Switchboard } from "@/types/database";

export type CostBreakdown = {
  electrical: number;
  busbars: number;
  enclosure: number;
  rmTotal: number;
  wiringAmt: number;
  assemblyAmt: number;
  testingAmt: number;
  laborTotal: number;
  mfgTotal: number;
};

// RM (raw materials) = Electrical (placed feeders' item costs) + Busbars +
// Enclosure line items. Labor/adders are a % of RM total (matches the
// mockup's Cost Breakdown card), not itemized labor lines.
export async function getSwitchboardCostBreakdown(
  supabase: SupabaseClient,
  switchboard: Pick<Switchboard, "id" | "labor_wiring_pct" | "labor_assembly_pct" | "labor_testing_pct">
): Promise<CostBreakdown> {
  const [{ data: verticals }, { data: busbarRows }, { data: enclosureRows }, feederCosts] = await Promise.all([
    supabase.from("verticals").select("id").eq("switchboard_id", switchboard.id),
    supabase.from("switchboard_busbars").select("qty, rate").eq("switchboard_id", switchboard.id),
    supabase.from("switchboard_enclosure_lines").select("qty, rate").eq("switchboard_id", switchboard.id),
    getFeederCosts(supabase),
  ]);

  const verticalIds = ((verticals ?? []) as { id: string }[]).map((v) => v.id);
  const { data: placed } = verticalIds.length
    ? await supabase.from("placed_feeders").select("feeder_id, qty").in("vertical_id", verticalIds)
    : { data: [] };

  const electrical = ((placed ?? []) as { feeder_id: string; qty: number }[]).reduce(
    (sum, p) => sum + p.qty * (feederCosts.get(p.feeder_id) ?? 0),
    0
  );
  const busbars = ((busbarRows ?? []) as { qty: number; rate: number }[]).reduce((s, r) => s + r.qty * r.rate, 0);
  const enclosure = ((enclosureRows ?? []) as { qty: number; rate: number }[]).reduce((s, r) => s + r.qty * r.rate, 0);

  const rmTotal = electrical + busbars + enclosure;
  const wiringAmt = (rmTotal * switchboard.labor_wiring_pct) / 100;
  const assemblyAmt = (rmTotal * switchboard.labor_assembly_pct) / 100;
  const testingAmt = (rmTotal * switchboard.labor_testing_pct) / 100;
  const laborTotal = wiringAmt + assemblyAmt + testingAmt;
  const mfgTotal = rmTotal + laborTotal;

  return { electrical, busbars, enclosure, rmTotal, wiringAmt, assemblyAmt, testingAmt, laborTotal, mfgTotal };
}
