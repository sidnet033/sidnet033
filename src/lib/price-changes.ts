import { effectiveNetRate } from "@/lib/feeder-cost";
import type { ItemMaster } from "@/types/database";

// Price changes picked up by "Refresh items": a page opened a while ago holds
// a snapshot of each item's price; someone may have changed it in Item Master
// since. Each changed item is listed with the lines that use it so the user
// can pick, per item, whether to use the new price or keep the one they had.
// Keeping the old price saves it on those lines as a price override (list
// price + discount), the same field a user edits by hand.

export type PricedLine = {
  lineId: string;
  item: ItemMaster;
  where: string; // e.g. the feeder's name
  list_price_override: number | null;
  discount_pct_override: number | null;
};

export type PriceChange = {
  itemId: string;
  old: ItemMaster;
  fresh: ItemMaster;
  oldNet: number;
  newNet: number;
  lines: PricedLine[];
  maskedLines: number; // lines whose own override already fixes the price, so the change has no effect there
};

export type PriceDecision = Pick<PricedLine, "lineId" | "item" | "list_price_override" | "discount_pct_override">;

function priceChanged(a: ItemMaster, b: ItemMaster) {
  return a.list_price !== b.list_price || a.discount_pct !== b.discount_pct || a.unit_cost !== b.unit_cost;
}

export function findPriceChanges(lines: PricedLine[], fresh: ItemMaster[]): PriceChange[] {
  const freshById = new Map(fresh.map((i) => [i.id, i]));
  const byItem = new Map<string, PriceChange>();
  for (const line of lines) {
    const now = freshById.get(line.item.id);
    if (!now || !priceChanged(line.item, now)) continue;
    let c = byItem.get(now.id);
    if (!c) {
      c = { itemId: now.id, old: line.item, fresh: now, oldNet: effectiveNetRate(line.item), newNet: effectiveNetRate(now), lines: [], maskedLines: 0 };
      byItem.set(now.id, c);
    }
    c.lines.push(line);
    const before = effectiveNetRate(line.item, line.list_price_override, line.discount_pct_override);
    const after = effectiveNetRate(now, line.list_price_override, line.discount_pct_override);
    if (before === after) c.maskedLines++;
  }
  return [...byItem.values()].sort((a, b) => Math.abs(b.newNet - b.oldNet) - Math.abs(a.newNet - a.oldNet));
}

// Every changed line gets the fresh item (so code, description etc. are
// current). Lines of items the user chose to keep get the old price pinned
// as their override, so their net rate stays exactly what it was; a line's
// existing overrides are left as they are.
export function resolvePriceChanges(changes: PriceChange[], useNew: Set<string>): PriceDecision[] {
  const out: PriceDecision[] = [];
  for (const c of changes) {
    for (const l of c.lines) {
      if (useNew.has(c.itemId)) {
        out.push({ lineId: l.lineId, item: c.fresh, list_price_override: l.list_price_override, discount_pct_override: l.discount_pct_override });
        continue;
      }
      const list = l.list_price_override ?? c.old.list_price ?? c.old.unit_cost;
      const disc = l.discount_pct_override ?? (l.list_price_override != null || c.old.list_price != null ? c.old.discount_pct ?? 0 : 0);
      out.push({ lineId: l.lineId, item: c.fresh, list_price_override: list, discount_pct_override: disc });
    }
  }
  return out;
}
