import type { ItemMaster } from "@/types/database";

// Active items suspected of being the same thing, grouped: two items are
// linked when they share a SKU, a vendor cat #, or the same description AND
// make (case/space-insensitive). Links chain, so A~B and B~C put A, B, C in
// one group. Each group says WHY its items were linked.
export type DuplicateGroup = {
  key: string;
  items: ItemMaster[];
  reasons: string[];
};

const norm = (s: string | null | undefined) =>
  (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function findDuplicateGroups(items: ItemMaster[]): DuplicateGroup[] {
  const active = items.filter((i) => i.status === "active");
  const parent = new Map<string, string>(active.map((i) => [i.id, i.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // key -> ids, per rule, with a human label
  const rules: {
    label: (v: string, sample: ItemMaster) => string;
    keyOf: (i: ItemMaster) => string | null;
  }[] = [
    {
      label: (_v, s) => `Same SKU "${s.sku}"`,
      keyOf: (i) => (norm(i.sku) ? norm(i.sku) : null),
    },
    {
      label: (_v, s) => `Same vendor cat # "${s.vendor_cat}"`,
      keyOf: (i) => (norm(i.vendor_cat) ? norm(i.vendor_cat) : null),
    },
    {
      label: (_v, s) =>
        `Same description and make ("${s.description}", ${s.make})`,
      keyOf: (i) =>
        norm(i.description) && norm(i.make)
          ? `${norm(i.description)}|${norm(i.make)}`
          : null,
    },
  ];
  const linkReasons: { ids: string[]; reason: string }[] = [];
  for (const rule of rules) {
    const byKey = new Map<string, ItemMaster[]>();
    for (const i of active) {
      const k = rule.keyOf(i);
      if (!k) continue;
      byKey.set(k, [...(byKey.get(k) ?? []), i]);
    }
    for (const [k, list] of byKey) {
      if (list.length < 2) continue;
      for (let n = 1; n < list.length; n++) union(list[0].id, list[n].id);
      linkReasons.push({
        ids: list.map((i) => i.id),
        reason: `${rule.label(k, list[0])} — ${list.length} items`,
      });
    }
  }

  const groups = new Map<string, DuplicateGroup>();
  for (const i of active) {
    const r = find(i.id);
    let g = groups.get(r);
    if (!g) {
      g = { key: r, items: [], reasons: [] };
      groups.set(r, g);
    }
    g.items.push(i);
  }
  for (const lr of linkReasons) {
    const g = groups.get(find(lr.ids[0]));
    if (g && !g.reasons.includes(lr.reason)) g.reasons.push(lr.reason);
  }
  return [...groups.values()]
    .filter((g) => g.items.length > 1)
    .sort((a, b) =>
      (a.items[0].description ?? "").localeCompare(
        b.items[0].description ?? "",
      ),
    );
}
