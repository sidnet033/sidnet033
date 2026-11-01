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

type Current = { lp: number | null; disc: number | null };

// Paste <code> <list price> [discount %] rows, see each item's current
// price next to the new one, approve row by row, apply. The caller says
// where the prices go (this switchboard's feeders, or the feeder library),
// how many feeder lines each item touches and what those lines have now.
export function PastePricesDialog({
  title,
  scopeNote,
  items,
  linesFor,
  currentFor,
  onApply,
  onClose,
}: {
  title: string;
  scopeNote: string;
  items: ItemMaster[];
  /** feeder lines (and feeders) that use this item, in scope */
  linesFor: (itemId: string) => { lines: number; feeders: number };
  /** the list price / discount the item's lines have now (distinct values) */
  currentFor?: (itemId: string) => Current[];
  onApply: (updates: PriceUpdate[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // rows the user unticked (keyed by pasted line number)
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const rows: PriceRow[] = useMemo(
    () => (text.trim() ? parsePastedPrices(text, items) : []),
    [text, items],
  );

  const curOf = (r: PriceRow) =>
    r.item && currentFor ? currentFor(r.item.id) : [];
  // a row changes nothing if every line already has exactly this price (and discount, if given)
  const isNoChange = (r: PriceRow) => {
    const cur = curOf(r);
    return (
      cur.length > 0 &&
      cur.every(
        (c) =>
          Number(c.lp) === r.listPrice &&
          (r.discountPct == null || Number(c.disc) === r.discountPct),
      )
    );
  };
  const status = (r: PriceRow): { ok: boolean; note: string } => {
    if (r.problem) return { ok: false, note: r.problem };
    const hit = linesFor(r.item!.id);
    if (hit.lines === 0)
      return { ok: false, note: "Not used in any feeder here" };
    if (isNoChange(r))
      return { ok: false, note: "No change — already this price" };
    return {
      ok: true,
      note: `${hit.lines} line${hit.lines === 1 ? "" : "s"} in ${hit.feeders} feeder${hit.feeders === 1 ? "" : "s"}`,
    };
  };
  const changing = rows.filter((r) => status(r).ok);
  const approved = changing.filter((r) => !unticked.has(r.line));
  const totalLines = approved.reduce(
    (a, r) => a + linesFor(r.item!.id).lines,
    0,
  );

  const fmt = (n: number | null) =>
    n == null ? "—" : Number(n).toLocaleString("en-IN");
  const fmtCur = (r: PriceRow) => {
    const cur = curOf(r);
    if (cur.length === 0) return "—";
    if (cur.length > 1) return `${cur.length} different`;
    return `${fmt(cur[0].lp)} / ${cur[0].disc != null ? `${Number(cur[0].disc)}%` : "—"}`;
  };

  async function apply() {
    setBusy(true);
    try {
      await onApply(
        approved.map((r) => ({
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
    <Modal title={title} onClose={onClose} width="max-w-5xl">
      <div className="space-y-3 text-sm">
        <p className="text-[13px] text-secondary">
          Paste from Excel or Notepad, one item per line:{" "}
          <b>SKU or vendor cat #</b>, <b>list price</b>, and optionally{" "}
          <b>discount %</b>. {scopeNote} Prices are stored on the feeder lines
          only — Item Master isn&apos;t changed. With no discount column, each
          line keeps its current discount.{" "}
          <b>Review each change and untick any you don&apos;t approve.</b>
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setUnticked(new Set());
          }}
          rows={5}
          placeholder={"1SDA072344R1\t125000\t35\nLV429630\t4500"}
          className="w-full rounded border border-surface-container-high p-2 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {rows.length > 0 && (
          <div className="max-h-80 overflow-y-auto rounded border border-surface-container-high">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-secondary">
                <tr>
                  <th className="w-8 px-2 py-1" />
                  <th className="px-2 py-1">Line</th>
                  <th className="px-2 py-1">Code</th>
                  <th className="px-2 py-1">Item</th>
                  {currentFor && (
                    <th className="px-2 py-1 text-right">Now (LP / disc)</th>
                  )}
                  <th className="px-2 py-1 text-right">New list price</th>
                  <th className="px-2 py-1 text-right">New disc %</th>
                  <th className="px-2 py-1">Will update</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = status(r);
                  const off = st.ok && unticked.has(r.line);
                  return (
                    <tr
                      key={r.line}
                      className={`border-t border-surface-container ${off ? "opacity-50" : ""}`}
                    >
                      <td className="px-2 py-1">
                        {st.ok && (
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={!unticked.has(r.line)}
                            onChange={() =>
                              setUnticked((prev) => {
                                const n = new Set(prev);
                                if (n.has(r.line)) n.delete(r.line);
                                else n.add(r.line);
                                return n;
                              })
                            }
                          />
                        )}
                      </td>
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
                      {currentFor && (
                        <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-secondary">
                          {fmtCur(r)}
                        </td>
                      )}
                      <td className="px-2 py-1 text-right font-bold tabular-nums">
                        {fmt(r.listPrice)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.discountPct ?? "keep"}
                      </td>
                      <td
                        className={`px-2 py-1 ${st.ok ? "text-emerald-700" : "text-amber-700"}`}
                      >
                        {st.note}
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
              : `${approved.length} of ${changing.length} change${changing.length === 1 ? "" : "s"} approved · ${totalLines} feeder line${totalLines === 1 ? "" : "s"} will change`}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-outline btn-sm">
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={busy || approved.length === 0}
              className="btn btn-primary btn-sm"
            >
              {busy
                ? "Updating..."
                : `Apply ${approved.length} approved change${approved.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
