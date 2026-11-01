"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { itemCode } from "@/lib/item-display";
import { parsePastedPrices, type PriceRow } from "@/lib/price-paste";
import type { ItemMaster } from "@/types/database";

export type PriceUpdate = {
  item: ItemMaster;
  listPrice: number;
  discountPct: number | null;
};

// Paste <code> <list price> [discount %] rows, preview what matches, apply.
// The caller says where the prices go (this switchboard's feeders, or the
// feeder library) and how many feeder lines each item touches.
export function PastePricesDialog({
  title,
  scopeNote,
  items,
  linesFor,
  onApply,
  onClose,
}: {
  title: string;
  scopeNote: string;
  items: ItemMaster[];
  /** feeder lines (and feeders) that use this item, in scope */
  linesFor: (itemId: string) => { lines: number; feeders: number };
  onApply: (updates: PriceUpdate[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const rows: PriceRow[] = useMemo(
    () => (text.trim() ? parsePastedPrices(text, items) : []),
    [text, items],
  );
  const good = rows.filter((r) => !r.problem && r.item && r.listPrice != null);
  const usable = good.filter((r) => linesFor(r.item!.id).lines > 0);
  const totalLines = usable.reduce((a, r) => a + linesFor(r.item!.id).lines, 0);

  async function apply() {
    setBusy(true);
    try {
      await onApply(
        usable.map((r) => ({
          item: r.item!,
          listPrice: r.listPrice!,
          discountPct: r.discountPct,
        })),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width="max-w-4xl">
      <div className="space-y-3 text-sm">
        <p className="text-[13px] text-secondary">
          Paste from Excel or Notepad, one item per line:{" "}
          <b>SKU or vendor cat #</b>, <b>list price</b>, and optionally{" "}
          <b>discount %</b>. {scopeNote} Prices are stored on the feeder lines
          only — Item Master isn&apos;t changed. With no discount column, each
          line keeps its current discount.
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={"1SDA072344R1\t125000\t35\nLV429630\t4500"}
          className="w-full rounded border border-surface-container-high p-2 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {rows.length > 0 && (
          <div className="max-h-72 overflow-y-auto rounded border border-surface-container-high">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-secondary">
                <tr>
                  <th className="px-2 py-1">Line</th>
                  <th className="px-2 py-1">Code</th>
                  <th className="px-2 py-1">Item</th>
                  <th className="px-2 py-1 text-right">List price</th>
                  <th className="px-2 py-1 text-right">Disc %</th>
                  <th className="px-2 py-1">Will update</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const hit = r.item && !r.problem ? linesFor(r.item.id) : null;
                  const note =
                    r.problem ??
                    (hit && hit.lines > 0
                      ? `${hit.lines} line${hit.lines === 1 ? "" : "s"} in ${hit.feeders} feeder${hit.feeders === 1 ? "" : "s"}`
                      : "Not used in any feeder here");
                  const ok = !r.problem && hit && hit.lines > 0;
                  return (
                    <tr
                      key={r.line}
                      className="border-t border-surface-container"
                    >
                      <td className="px-2 py-1 text-secondary">{r.line}</td>
                      <td className="px-2 py-1 font-mono">{r.code}</td>
                      <td
                        className="max-w-72 truncate px-2 py-1"
                        title={r.item?.description}
                      >
                        {r.item
                          ? `${itemCode(r.item)} — ${r.item.description}`
                          : "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.listPrice != null
                          ? r.listPrice.toLocaleString("en-IN")
                          : "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.discountPct ?? "keep"}
                      </td>
                      <td
                        className={`px-2 py-1 ${ok ? "text-emerald-700" : "text-amber-700"}`}
                      >
                        {note}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-surface-container pt-3">
          <p className="text-[12px] text-secondary">
            {rows.length === 0
              ? "Nothing pasted yet."
              : `${usable.length} of ${rows.length} row${rows.length === 1 ? "" : "s"} usable · ${totalLines} feeder line${totalLines === 1 ? "" : "s"} will change`}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-outline btn-sm">
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={busy || usable.length === 0}
              className="btn btn-primary btn-sm"
            >
              {busy
                ? "Updating..."
                : `Update ${totalLines} line${totalLines === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
