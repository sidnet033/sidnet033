import type { SupabaseClient } from "@supabase/supabase-js";

// Feeders added from BOM Builder don't need a bay picked yet — they land
// in one implicit "Unallocated" bay/vertical per switchboard until GA
// Builder assigns them a real bay + tier. This keeps BOM authorship and
// GA placement decoupled without a second junction table.
export const UNASSIGNED_BAY_NAME = "Unallocated";

export async function ensureUnassignedVertical(
  supabase: SupabaseClient,
  switchboardId: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("verticals")
    .select("id")
    .eq("switchboard_id", switchboardId)
    .eq("bay_type", "unassigned")
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data, error } = await supabase
    .from("verticals")
    .insert({ switchboard_id: switchboardId, name: UNASSIGNED_BAY_NAME, bay_type: "unassigned", sort_order: -1 })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}
