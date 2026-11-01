import { fetchAllRows } from "@/lib/fetch-all";
import type { SupabaseClient } from "@supabase/supabase-js";

// A feeder line's price: an explicit per-line override (set once a user
// edits List Price / Disc % for that line in BOM Builder) always wins and
// is never re-derived from Item Master again. Otherwise fall back to the
// item's own list price x (1 - discount %), and finally to unit_cost when
// no list price is set at all.
export function effectiveNetRate(
  item: {
    unit_cost: number;
    list_price: number | null;
    discount_pct: number | null;
  },
  overrideListPrice?: number | null,
  overrideDiscountPct?: number | null,
): number {
  const listPrice = overrideListPrice ?? item.list_price;
  const discountPct = overrideDiscountPct ?? item.discount_pct;
  if (listPrice != null && discountPct != null)
    return listPrice * (1 - discountPct / 100);
  if (listPrice != null) return listPrice;
  return item.unit_cost;
}

// Total cost of every feeder in the library, computed from its
// feeder_items x effective net rate. Used by the feeder list, the GA
// canvas library panel, and the costing summary.
export async function getFeederCosts(
  supabase: SupabaseClient,
  feederIds?: string[],
): Promise<Map<string, number>> {
  // Paged: feeder_items is past 1000 rows, and a single select silently
  // stops there -- feeders beyond the cut-off were costing 0.
  const ids = feederIds ? Array.from(new Set(feederIds)) : null;
  if (ids && ids.length === 0) return new Map();
  const cols =
    "id, feeder_id, qty, list_price_override, discount_pct_override, item_master(unit_cost, list_price, discount_pct)";
  const lines: unknown[] = [];
  const chunks = ids
    ? Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) =>
        ids.slice(i * 200, i * 200 + 200),
      )
    : [null];
  for (const chunk of chunks) {
    lines.push(
      ...(await fetchAllRows((from, to) => {
        const q = supabase.from("feeder_items").select(cols);
        return (chunk ? q.in("feeder_id", chunk) : q)
          .order("id")
          .range(from, to);
      })),
    );
  }

  const costByFeeder = new Map<string, number>();
  for (const line of lines as {
    feeder_id: string;
    qty: number;
    list_price_override: number | null;
    discount_pct_override: number | null;
    item_master: {
      unit_cost: number;
      list_price: number | null;
      discount_pct: number | null;
    } | null;
  }[]) {
    const current = costByFeeder.get(line.feeder_id) ?? 0;
    const rate = line.item_master
      ? effectiveNetRate(
          line.item_master,
          line.list_price_override,
          line.discount_pct_override,
        )
      : 0;
    costByFeeder.set(line.feeder_id, current + line.qty * rate);
  }
  return costByFeeder;
}
