import { itemCode } from "@/lib/item-display";
import type { ItemMaster } from "@/types/database";

// Item search used wherever items are picked for a feeder. The text can
// hold several phrases separated by "|"; an item matches if ANY phrase is
// found in its SKU, vendor cat #, make, category or description. Items
// matching more of the phrases are listed first, so "acb|3co|teknic"
// puts items that are all three at the top.
export function searchPhrases(query: string): string[] {
  return query
    .split("|")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

function haystack(i: ItemMaster) {
  return [itemCode(i), i.sku, i.vendor_cat, i.make, i.category, i.description]
    .filter(Boolean)
    .join(" \u0000 ")
    .toLowerCase();
}

/** how many of the phrases this item matches (0 = no match) */
export function itemSearchScore(item: ItemMaster, phrases: string[]): number {
  const h = haystack(item);
  let score = 0;
  for (const p of phrases) if (h.includes(p)) score++;
  return score;
}

/** same "a|b|c" rule for any records: rank by how many phrases appear in text(record) */
export function searchByPhrases<T>(
  records: T[],
  query: string,
  text: (r: T) => string,
  limit: number,
): T[] {
  const phrases = searchPhrases(query);
  if (!phrases.length) return records.slice(0, limit);
  return records
    .map((r, idx) => {
      const h = text(r).toLowerCase();
      return { r, idx, score: phrases.filter((p) => h.includes(p)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, limit)
    .map((x) => x.r);
}

export function searchItems(
  items: ItemMaster[],
  query: string,
  limit: number,
  keep: (i: ItemMaster) => boolean = () => true,
): ItemMaster[] {
  const phrases = searchPhrases(query);
  if (!phrases.length) return [];
  const scored: { item: ItemMaster; score: number; idx: number }[] = [];
  items.forEach((item, idx) => {
    if (!keep(item)) return;
    const score = itemSearchScore(item, phrases);
    if (score > 0) scored.push({ item, score, idx });
  });
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.slice(0, limit).map((s) => s.item);
}
