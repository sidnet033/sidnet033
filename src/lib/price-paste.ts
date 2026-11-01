import { buildItemIndex, lookupCode } from "@/lib/item-paste";
import type { ItemMaster } from "@/types/database";

// Pasted pricing data -- one item per line, from Excel (tab-separated) or
// Notepad (spaces, commas or semicolons):
//   <SKU or vendor cat #>  <list price>  [discount %]
// Numbers may carry ₹, thousands commas or a trailing %.
export type PriceRow = {
  line: number;
  code: string;
  item: ItemMaster | null;
  listPrice: number | null;
  discountPct: number | null;
  problem: string | null;
};

function num(cell: string): number | null {
  const c = cell.replace(/[₹\s]/g, "").replace(/,/g, "").replace(/%$/, "");
  if (!/^\d+(\.\d+)?$/.test(c)) return null;
  return Number(c);
}

export function parsePastedPrices(
  text: string,
  items: ItemMaster[],
): PriceRow[] {
  const index = buildItemIndex(items);
  const rows: PriceRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const lineText = raw.trim();
    if (!lineText) return;
    const cells = (
      lineText.includes("\t")
        ? lineText.split("\t")
        : lineText.split(/\s*;\s*|\s{2,}|\s+(?=[₹\d])|,\s+/)
    )
      .map((c) => c.trim())
      .filter(Boolean);
    if (!cells.length) return;
    // code = first cell that is a known item code, else the first non-number
    let codeIdx = cells.findIndex((c) => lookupCode(index, c).length > 0);
    if (codeIdx === -1)
      codeIdx = Math.max(
        0,
        cells.findIndex((c) => num(c) == null),
      );
    const code = cells[codeIdx];
    const numbers = cells.filter((_, ci) => ci !== codeIdx).map(num);
    const listPrice = numbers[0] ?? null;
    const discountPct = numbers.length > 1 ? numbers[1] : null;
    const item = lookupCode(index, code)[0] ?? null;
    let problem: string | null = null;
    if (!item) problem = "Code not found in Item Master";
    else if (listPrice == null) problem = "No list price";
    else if (numbers.some((n, k) => n == null && k < 2))
      problem = "Price or discount isn't a number";
    else if (discountPct != null && discountPct > 100)
      problem = "Discount over 100%";
    rows.push({ line: i + 1, code, item, listPrice, discountPct, problem });
  });
  // the same item pasted twice: the last line wins
  const lastByItem = new Map<string, number>();
  rows.forEach((r, k) => r.item && !r.problem && lastByItem.set(r.item.id, k));
  rows.forEach((r, k) => {
    if (r.item && !r.problem && lastByItem.get(r.item.id) !== k)
      r.problem = `Repeated — line ${rows[lastByItem.get(r.item.id)!].line} is used`;
  });
  return rows;
}
