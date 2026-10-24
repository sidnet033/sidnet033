"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { createClient } from "@/lib/supabase/client";
import { fetchAllItemMaster, itemCode } from "@/lib/item-display";
import { formatMoney } from "@/lib/money";
import { findPriceChanges, resolvePriceChanges, type PriceChange, type PriceDecision, type PricedLine } from "@/lib/price-changes";
import type { ItemMaster } from "@/types/database";

// Reloads Item Master into a page that was opened a while ago (BOM Builder,
// Feeder Master) -- someone else may have added or updated items since, e.g.
// the ones a paste reported as missing. Only the item list is replaced;
// unsaved edits on the page are untouched. Says how many items are new /
// changed since the list was last loaded.
//
// When the page passes the lines it shows (`lines`), items whose price has
// changed since are listed in a dialog and the user picks, per item, the new
// price or the old one; the result goes back through `onPriceDecisions`.
export function RefreshItemsButton({
  items,
  onRefreshed,
  lines,
  onPriceDecisions,
}: {
  items: ItemMaster[];
  onRefreshed: (fresh: ItemMaster[]) => void;
  lines?: PricedLine[];
  onPriceDecisions?: (decisions: PriceDecision[]) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [changes, setChanges] = useState<PriceChange[] | null>(null);
  const [useNew, setUseNew] = useState<Set<string>>(new Set());

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const fresh = await fetchAllItemMaster(supabase);
      const before = new Map(items.map((i) => [i.id, i.updated_at]));
      const added = fresh.filter((i) => !before.has(i.id)).length;
      const updated = fresh.filter((i) => before.has(i.id) && before.get(i.id) !== i.updated_at).length;
      onRefreshed(fresh);
      const found = lines && onPriceDecisions ? findPriceChanges(lines, fresh) : [];
      setMessage(
        (added || updated
          ? [added ? `${added} new` : null, updated ? `${updated} updated` : null].filter(Boolean).join(", ") + ` item${added + updated === 1 ? "" : "s"} loaded`
          : "No new items since you opened this page") +
          (found.length ? ` — ${found.length} price change${found.length === 1 ? "" : "s"} on this page` : "")
      );
      if (found.length) {
        setUseNew(new Set(found.map((c) => c.itemId)));
        setChanges(found);
      }
    } catch (e) {
      setMessage(`Could not refresh items${e instanceof Error ? ` (${e.message})` : ""}`);
    } finally {
      setBusy(false);
      setTimeout(() => setMessage(null), 6000);
    }
  }

  function apply(all: Set<string>) {
    if (!changes || !onPriceDecisions) return;
    onPriceDecisions(resolvePriceChanges(changes, all));
    setChanges(null);
  }

  function toggle(id: string) {
    setUseNew((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={refresh}
        disabled={busy}
        title="Reload Item Master — picks up items added or updated by anyone since this page was opened, and flags price changes on items used here. Your unsaved edits stay."
        className="btn btn-outline"
      >
        <Icon name="refresh" size={16} className={busy ? "animate-spin" : undefined} /> {busy ? "Refreshing..." : "Refresh items"}
      </button>
      {message && <span className="text-xs text-on-surface-variant">{message}</span>}
      {changes && <PriceChangesDialog changes={changes} useNew={useNew} onToggle={toggle} onSetAll={setUseNew} onApply={() => apply(useNew)} onKeepAll={() => apply(new Set())} />}
    </span>
  );
}

function money(n: number | null) {
  return n == null ? "—" : formatMoney(n);
}

function PriceChangesDialog({
  changes,
  useNew,
  onToggle,
  onSetAll,
  onApply,
  onKeepAll,
}: {
  changes: PriceChange[];
  useNew: Set<string>;
  onToggle: (id: string) => void;
  onSetAll: (s: Set<string>) => void;
  onApply: () => void;
  onKeepAll: () => void;
}) {
  const allTicked = changes.every((c) => useNew.has(c.itemId));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl">
        <div className="border-b border-surface-container-high px-5 py-3">
          <h2 className="text-base font-semibold text-on-surface">Item prices changed</h2>
          <p className="text-xs text-secondary">
            {changes.length} item{changes.length === 1 ? "" : "s"} used on this page had {changes.length === 1 ? "its" : "their"} price changed in Item Master since you opened it. Tick the ones
            to move to the new price; unticked items keep the old price, saved as a price override on their lines.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full text-left text-xs">
            <thead className="text-on-surface-variant">
              <tr className="border-b border-surface-container-high">
                <th className="py-1.5 pr-2">
                  <input type="checkbox" checked={allTicked} onChange={() => onSetAll(allTicked ? new Set() : new Set(changes.map((c) => c.itemId)))} title="Use new price for all" />
                </th>
                <th className="py-1.5 pr-2">Item</th>
                <th className="py-1.5 pr-2">Used in</th>
                <th className="py-1.5 pr-2 text-right">List price</th>
                <th className="py-1.5 pr-2 text-right">Discount</th>
                <th className="py-1.5 pr-2 text-right">Net rate</th>
                <th className="py-1.5 text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => {
                const diff = c.newNet - c.oldNet;
                const pct = c.oldNet ? (diff / c.oldNet) * 100 : null;
                const where = Array.from(new Set(c.lines.map((l) => l.where)));
                return (
                  <tr key={c.itemId} className="border-b border-surface-container-high align-top">
                    <td className="py-2 pr-2">
                      <input type="checkbox" checked={useNew.has(c.itemId)} onChange={() => onToggle(c.itemId)} />
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-medium text-on-surface">{itemCode(c.fresh)}</div>
                      <div className="text-on-surface-variant">{c.fresh.description}</div>
                      {c.maskedLines > 0 && (
                        <div className="mt-0.5 text-amber-700">
                          {c.maskedLines === c.lines.length ? "All its lines" : `${c.maskedLines} of ${c.lines.length} lines`} already have their own price override — no effect there.
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-on-surface-variant">
                      {where.slice(0, 3).join(", ")}
                      {where.length > 3 ? ` +${where.length - 3} more` : ""}
                    </td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      <div className="text-on-surface-variant line-through">{money(c.old.list_price)}</div>
                      <div>{money(c.fresh.list_price)}</div>
                    </td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      <div className="text-on-surface-variant line-through">{c.old.discount_pct == null ? "—" : `${c.old.discount_pct}%`}</div>
                      <div>{c.fresh.discount_pct == null ? "—" : `${c.fresh.discount_pct}%`}</div>
                    </td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      <div className="text-on-surface-variant line-through">{money(c.oldNet)}</div>
                      <div className="font-medium">{money(c.newNet)}</div>
                    </td>
                    <td className={`py-2 text-right whitespace-nowrap font-medium ${diff > 0 ? "text-red-700" : diff < 0 ? "text-green-700" : "text-on-surface-variant"}`}>
                      {diff > 0 ? "+" : ""}
                      {money(diff)}
                      {pct != null && <div className="font-normal">{`${diff > 0 ? "+" : ""}${pct.toFixed(1)}%`}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-surface-container-high px-5 py-3">
          <button onClick={onKeepAll} className="btn btn-outline btn-sm">
            Keep all old prices
          </button>
          <button onClick={onApply} className="btn btn-primary btn-sm">
            Apply ({useNew.size} new, {changes.length - useNew.size} kept)
          </button>
        </div>
      </div>
    </div>
  );
}
