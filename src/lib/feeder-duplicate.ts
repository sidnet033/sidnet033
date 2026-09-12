import type { SupabaseClient } from "@supabase/supabase-js";

// "Contains the same items" = same set of item ids, regardless of quantity.
export async function findDuplicateLibraryFeeder(
  supabase: SupabaseClient,
  itemIds: string[],
  excludeFeederId?: string
): Promise<{ id: string; name: string } | null> {
  const target = Array.from(new Set(itemIds)).sort();
  if (target.length === 0) return null;

  const { data: libraryFeeders } = await supabase
    .from("feeders")
    .select("id, name")
    .eq("is_library", true);

  for (const lf of (libraryFeeders ?? []) as { id: string; name: string }[]) {
    if (lf.id === excludeFeederId) continue;
    const { data: lines } = await supabase.from("feeder_items").select("item_id").eq("feeder_id", lf.id);
    const candidate = Array.from(new Set(((lines ?? []) as { item_id: string }[]).map((l) => l.item_id))).sort();
    if (candidate.length === target.length && candidate.every((id, i) => id === target[i])) {
      return lf;
    }
  }
  return null;
}
