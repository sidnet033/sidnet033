import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemMaster } from "@/types/database";

// Every item has a SKU or a vendor catalog number (or both) — never neither.
export function itemCode(item: Pick<ItemMaster, "sku" | "vendor_cat">): string {
  return item.sku ?? item.vendor_cat ?? "—";
}

// ACB/MCCB/MCB items carry their own electrical rating (distinct from
// whatever feeder they end up in) -- Amps/Poles/kA become compulsory for
// them specifically, everything else only needs the base fields below.
export function isBreakerCategory(category: string | null | undefined): boolean {
  const c = (category ?? "").trim().toUpperCase();
  return c === "ACB" || c === "MCCB" || c === "MCB";
}

// The one compulsory-field rule for creating/importing an item master row,
// shared by CreateItemDialog, the item xlsx/Google Sheet import
// (item-import.ts), and the feeder import's missing-item creation flow
// (feeder-import.ts) -- so the rule can only ever be defined once. Base
// rule: (SKU or Vendor Cat) + Description (the item's name) + Make +
// Category + Source. ACB/MCCB/MCB items additionally need Amps, Poles,
// and kA. Returns the first violation, or null when the row is valid.
export function validateNewItemFields(d: {
  sku: string | null;
  vendorCat: string | null;
  description: string | null;
  make: string | null;
  category: string | null;
  source: string | null;
  amps: number | null;
  poles: number | null;
  ka: number | null;
}): string | null {
  if (!d.sku?.trim() && !d.vendorCat?.trim()) return "SKU or Vendor Cat is required.";
  if (!d.description?.trim()) return "Description (item name) is required.";
  if (!d.make?.trim()) return "Make is required.";
  if (!d.category?.trim()) return "Category is required.";
  if (!d.source?.trim()) return "Source is required.";
  if (isBreakerCategory(d.category)) {
    if (d.amps == null) return "Amps is required for ACB/MCCB/MCB items.";
    if (d.poles == null) return "Poles is required for ACB/MCCB/MCB items.";
    if (d.ka == null) return "kA is required for ACB/MCCB/MCB items.";
  }
  return null;
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
