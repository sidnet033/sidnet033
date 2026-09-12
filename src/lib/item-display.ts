import type { ItemMaster } from "@/types/database";

// Every item has a SKU or a vendor catalog number (or both) — never neither.
export function itemCode(item: Pick<ItemMaster, "sku" | "vendor_cat">): string {
  return item.sku ?? item.vendor_cat ?? "—";
}
