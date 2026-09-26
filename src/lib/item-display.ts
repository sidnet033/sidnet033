import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemMaster } from "@/types/database";

// Every item has a SKU or a vendor catalog number (or both) — never neither.
export function itemCode(item: Pick<ItemMaster, "sku" | "vendor_cat">): string {
  return item.sku ?? item.vendor_cat ?? "—";
}

// Same identity rule the .xlsx/Google Sheet import uses: an item is a
// duplicate of an existing one if it shares a SKU or a Vendor Cat (either
// is enough — items only ever need one of the two to begin with).
export async function findDuplicateItem(
  supabase: SupabaseClient,
  candidate: { sku: string | null; vendor_cat: string | null }
): Promise<Pick<ItemMaster, "id" | "sku" | "vendor_cat" | "description"> | null> {
  const sku = candidate.sku?.trim() || null;
  const vendorCat = candidate.vendor_cat?.trim() || null;
  if (!sku && !vendorCat) return null;

  const filters: string[] = [];
  if (sku) filters.push(`sku.eq.${sku}`);
  if (vendorCat) filters.push(`vendor_cat.eq.${vendorCat}`);

  const { data, error } = await supabase
    .from("item_master")
    .select("id, sku, vendor_cat, description")
    .or(filters.join(","))
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as Pick<ItemMaster, "id" | "sku" | "vendor_cat" | "description">;
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
