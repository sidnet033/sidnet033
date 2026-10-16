"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { itemCode, itemRowClass } from "@/lib/item-display";
import { buildItemIndex, parsePastedCodes, type PasteRow } from "@/lib/item-paste";
import { numericKeyGuard } from "@/lib/numeric-input";
import type { ItemMaster } from "@/types/database";

type RowState = { include: boolean; qty: number; itemId: string | null };

// BOM Builder: paste a list of SKUs / catalogue numbers (from Excel or
// Notepad), see which ones the item master recognises, then add the ticked
// ones to the feeder in one go. Nothing is added until "Add".
export function BulkAddItemsDialog({
  feederName,
  allItems,
  existingItemIds,
  onAdd,
  onClose,
}: {
  feederName: string;
  allItems: ItemMaster[];
  existingItemIds: Set<string>;
  onAdd: (entries: { item: ItemMaster; qty: number }[]) => void;
  onClose: () => void;
}) {
  const index = useMemo(() => buildItemIndex(allItems), [allItems]);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PasteRow[] | null>(null);
  const [state, setState] = useState<Record<string, RowState>>({});

  function check() {
    const parsed = parsePastedCodes(text, index);
    setRows(parsed);
    setState(
      Object.fromEntries(
        parsed.map((r) => [
          r.key,
          // discontinued items start unticked so they aren't added by accident
          { include: r.matches.length > 0 && r.matches[0].status !== "discontinued", qty: r.qty, itemId: r.matches[0]?.id ?? null },
        ])
      )
    );
  }

  const byId = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);
  const found = rows?.filter((r) => r.matches.length > 0) ?? [];
  const missing = rows?.filter((r) => r.matches.length === 0) ?? [];
  const chosen = (rows ?? []).filter((r) => state[r.key]?.include && state[r.key]?.itemId);

  function patch(key: string, p: Partial<RowState>) {
    setState((s) => ({ ...s, [key]: { ...s[key], ...p } }));
  }

  function add() {
    // the same item pasted twice becomes one line with the quantities summed
    const totals = new Map<string, number>();
    for (const r of chosen) {
      const s = state[r.key];
      totals.set(s.itemId!, (totals.get(s.itemId!) ?? 0) + (s.qty > 0 ? s.qty : 1));
    }
    onAdd([...totals.entries()].map(([id, qty]) => ({ item: byId.get(id)!, qty })));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-surface-container-high px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-on-surface">Paste item codes</h2>
            <p className="text-xs text-secondary">Add several items to “{feederName}” at once.</p>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-on-surface" title="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-on-surface-variant">
              Paste SKUs or catalogue numbers, one per line. A quantity in the next column (from Excel) is picked up too; otherwise it&apos;s 1.
            </label>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setRows(null);
              }}
              rows={rows ? 4 : 10}
              placeholder={"1SDA072890R1\t2\n1SDA073953R1\t1\nMCCB-125A-4P"}
              className="w-full rounded border border-surface-container-high px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="mt-1 flex justify-end">
              <button onClick={check} disabled={!text.trim()} className="btn btn-secondary btn-sm">
                <Icon name="search" size={14} /> Check codes
              </button>
            </div>
          </div>

          {rows && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">{found.length} found</span>
                {missing.length > 0 && <span className="rounded bg-red-50 px-2 py-0.5 font-medium text-red-700">{missing.length} not found</span>}
                {rows.some((r) => r.matches.length > 1) && (
                  <span className="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                    {rows.filter((r) => r.matches.length > 1).length} with several matches — pick one
                  </span>
                )}
              </div>
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-on-surface-variant">
                  <tr className="border-b border-surface-container-high">
                    <th className="w-7 px-1 py-1.5" />
                    <th className="px-2 py-1.5">Pasted</th>
                    <th className="px-2 py-1.5 text-right">Qty</th>
                    <th className="px-2 py-1.5">Item master match</th>
                    <th className="px-2 py-1.5">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const s = state[r.key];
                    const item = s?.itemId ? byId.get(s.itemId) : null;
                    return (
                      <tr key={r.key} className={`border-b border-surface-container ${r.matches.length === 0 ? "bg-red-50/60" : ""}`}>
                        <td className="px-1 py-1">
                          {r.matches.length > 0 && (
                            <input type="checkbox" checked={s.include} onChange={() => patch(r.key, { include: !s.include })} aria-label={`Add ${r.code}`} />
                          )}
                        </td>
                        <td className="px-2 py-1 font-mono">{r.code}</td>
                        <td className="px-2 py-1 text-right">
                          {r.matches.length > 0 ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={s.qty}
                              onChange={(e) => patch(r.key, { qty: Number(e.target.value) || 0 })}
                              onKeyDown={numericKeyGuard()}
                              className="w-14 rounded border border-surface-container-high px-1 py-0.5 text-right"
                            />
                          ) : (
                            r.qty
                          )}
                        </td>
                        <td className="px-2 py-1">
                          {r.matches.length === 0 ? (
                            <span className="text-red-700">Not found in Item Master</span>
                          ) : r.matches.length === 1 ? (
                            <span className={itemRowClass(r.matches[0])}>
                              <span className="font-mono">{itemCode(r.matches[0])}</span> — {r.matches[0].description}
                              {r.matches[0].make ? ` (${r.matches[0].make})` : ""}
                            </span>
                          ) : (
                            <select
                              value={s.itemId ?? ""}
                              onChange={(e) => patch(r.key, { itemId: e.target.value })}
                              className="w-full max-w-md rounded border border-amber-300 px-1 py-0.5"
                            >
                              {r.matches.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {itemCode(m)} — {m.description}
                                  {m.make ? ` (${m.make})` : ""}
                                  {m.status === "discontinued" ? " — discontinued" : ""}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="px-2 py-1 text-[11px] text-secondary">
                          {item?.status === "discontinued" && <span className="text-red-700">Discontinued. </span>}
                          {item && existingItemIds.has(item.id) && <span>Already in feeder — qty will be added.</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {missing.length > 0 && (
                <p className="text-[11px] text-secondary">
                  Codes not found are skipped. Add them to the Item Master first (or use “Create New Item in Master &amp; Add”), then paste again.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-surface-container-high px-5 py-3">
          <button onClick={onClose} className="btn btn-outline btn-sm">
            Cancel
          </button>
          <button onClick={add} disabled={!rows || chosen.length === 0} className="btn btn-primary btn-sm">
            <Icon name="playlist_add" size={14} /> Add {chosen.length} item{chosen.length === 1 ? "" : "s"} to feeder
          </button>
        </div>
      </div>
    </div>
  );
}
