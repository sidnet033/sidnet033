import type { ItemMaster } from "@/types/database";

// Turns a block of text pasted from Excel or Notepad -- one item per line,
// optionally with a quantity in another column -- into item-master matches
// for BOM Builder's "Paste Item Codes" dialog. Codes are looked up against
// both SKU and vendor catalogue number, ignoring case, spaces, and (as a
// fallback) punctuation such as "-" "." "/".

export type PasteRow = {
  key: string;
  line: number; // 1-based line in the pasted text
  code: string;
  qty: number;
  matches: ItemMaster[]; // best first; empty = not found
};

const tight = (s: string) => s.toUpperCase().replace(/\s+/g, "");
const loose = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export type ItemIndex = { exact: Map<string, ItemMaster[]>; loose: Map<string, ItemMaster[]> };

export function buildItemIndex(items: ItemMaster[]): ItemIndex {
  const exact = new Map<string, ItemMaster[]>();
  const looseMap = new Map<string, ItemMaster[]>();
  const add = (map: Map<string, ItemMaster[]>, k: string, item: ItemMaster) => {
    if (!k) return;
    const list = map.get(k) ?? [];
    if (!list.includes(item)) list.push(item);
    map.set(k, list);
  };
  for (const item of items) {
    for (const code of [item.sku, item.vendor_cat]) {
      if (!code) continue;
      add(exact, tight(code), item);
      add(looseMap, loose(code), item);
    }
  }
  return { exact, loose: looseMap };
}

// Active items first, discontinued last.
function rank(list: ItemMaster[]): ItemMaster[] {
  const weight = (i: ItemMaster) => (i.status === "active" ? 0 : i.status === "inactive" ? 1 : 2);
  return [...list].sort((a, b) => weight(a) - weight(b));
}

export function lookupCode(index: ItemIndex, code: string): ItemMaster[] {
  const hit = index.exact.get(tight(code));
  if (hit?.length) return rank(hit);
  const l = loose(code);
  return l ? rank(index.loose.get(l) ?? []) : [];
}

function isQty(cell: string): boolean {
  return /^\d+(\.\d+)?$/.test(cell.trim()) && Number(cell) > 0;
}

export function parsePastedCodes(text: string, index: ItemIndex): PasteRow[] {
  const rows: PasteRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const lineText = raw.trim();
    if (!lineText) return;
    // Excel pastes columns tab-separated; Notepad lists may use commas,
    // semicolons or wide spaces.
    let cells = lineText.includes("\t") ? lineText.split("\t") : lineText.split(/\s*[,;]\s*|\s{2,}/);
    cells = cells.map((c) => c.trim()).filter(Boolean);
    if (cells.length === 0) return;

    // "A, B, C" on one line with no quantities = three codes
    const separateCodes = !lineText.includes("\t") && cells.length > 1 && cells.every((c) => !isQty(c));
    const groups = separateCodes ? cells.map((c) => [c]) : [cells];

    groups.forEach((g, gi) => {
      // the code is the first cell that matches an item (so a qty column
      // can come before or after it); otherwise the first non-numeric cell
      let codeIdx = g.findIndex((c) => lookupCode(index, c).length > 0);
      if (codeIdx === -1) codeIdx = Math.max(0, g.findIndex((c) => !isQty(c)));
      const code = g[codeIdx];
      const qtyCell = g.find((c, ci) => ci !== codeIdx && isQty(c));
      rows.push({
        key: `${i}-${gi}`,
        line: i + 1,
        code,
        qty: qtyCell ? Number(qtyCell) : 1,
        matches: lookupCode(index, code),
      });
    });
  });
  return rows;
}
