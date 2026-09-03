import type { SupabaseClient } from "@supabase/supabase-js";

// Total cost of every feeder in the library, computed from its
// feeder_items x item_master.unit_cost. Used by the feeder list, the GA
// canvas library panel, and the costing summary.
export async function getFeederCosts(
  supabase: SupabaseClient
): Promise<Map<string, number>> {
  const { data: lines } = await supabase
    .from("feeder_items")
    .select("feeder_id, qty, item_master(unit_cost)");

  const costByFeeder = new Map<string, number>();
  for (const line of (lines ?? []) as unknown as {
    feeder_id: string;
    qty: number;
    item_master: { unit_cost: number } | null;
  }[]) {
    const current = costByFeeder.get(line.feeder_id) ?? 0;
    costByFeeder.set(line.feeder_id, current + line.qty * (line.item_master?.unit_cost ?? 0));
  }
  return costByFeeder;
}
