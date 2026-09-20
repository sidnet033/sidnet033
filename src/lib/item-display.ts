import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemMaster } from "@/types/database";

// Every item has a SKU or a vendor catalog number (or both) — never neither.
export function itemCode(item: Pick<ItemMaster, "sku" | "vendor_cat">): string {
  return item.sku ?? item.vendor_cat ?? "—";
}

const PAGE_SIZE = 1000;

// A plain `.select("*")` on item_master silently truncates at whatever the
// project's PostgREST max-rows setting is (Supabase defaults to 1000) --
// once the catalog grows past that, the tail of it just goes missing from
// every list/search/picker with no error. This pages through with .range()
// so callers always get the full catalog regardless of that cap.
export async function fetchAllItemMaster(supabase: SupabaseClient): Promise<ItemMaster[]> {
  const all: ItemMaster[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("item_master")
      .select("*")
      .order("sku", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as ItemMaster[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}
