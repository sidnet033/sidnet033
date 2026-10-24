"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { itemCode } from "@/lib/item-display";
import { numericKeyGuard } from "@/lib/numeric-input";
import type { ItemMaster } from "@/types/database";

export type SplitPick = { lineId: string; qty: number };

// Splits one BOM feeder into two: the user ticks the items (and how many of
// each) to move out, and they become a new custom feeder with the same qty
// as the original. Nothing is written until the BOM is saved.
export function SplitFeederDialog({
  feederName,
  lines,
  onClose,
  onSplit,
}: {
  feederName: string;
  lines: { id: string; item: ItemMaster; qty: number }[];
  onClose: () => void;
  onSplit: (picks: SplitPick[], newName: string) => void;
}) {
  const [name, setName] = useState(`${feederName} (Split)`);
  const [picked, setPicked] = useState<Record<string, string>>({}); // lineId -> qty to move, as typed

  const picks: SplitPick[] = Object.entries(picked).map(([lineId, v]) => ({ lineId, qty: Number(v) }));
  const qtyOf = new Map(lines.map((l) => [l.id, l.qty]));
  const badQty = picks.some((p) => !(p.qty > 0) || p.qty > (qtyOf.get(p.lineId) ?? 0));
  const leftInOriginal = lines.some((l) => {
    const p = picks.find((x) => x.lineId === l.id);
    return !p || p.qty < l.qty;
  });
  const error = !picks.length
    ? "Tick at least one item to move."
    : badQty
      ? "Qty to move must be more than 0 and no more than the line's qty."
      : !leftInOriginal
        ? "Leave at least one item in the current feeder."
        : !name.trim()
          ? "Give the new feeder a name."
          : null;

  function toggle(id: string, qty: number) {
    setPicked((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = String(qty);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-surface-container-high px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-on-surface">Split feeder</h2>
            <p className="text-xs text-secondary">Tick the items to move out of “{feederName}” into a new feeder.</p>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-on-surface" title="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <label className="flex items-center gap-2 text-xs text-on-surface-variant">
            New feeder name
            <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded border border-surface-container-high px-2 py-1 text-sm text-on-surface" />
          </label>
          <table className="w-full text-left text-xs">
            <thead className="text-on-surface-variant">
              <tr className="border-b border-surface-container-high">
                <th className="py-1.5 pr-2">Move</th>
                <th className="py-1.5 pr-2">Item</th>
                <th className="py-1.5 pr-2 text-right">Qty in feeder</th>
                <th className="py-1.5 text-right">Qty to move</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const on = l.id in picked;
                return (
                  <tr key={l.id} className={`border-b border-surface-container-high ${on ? "bg-primary/5" : ""}`}>
                    <td className="py-1.5 pr-2">
                      <input type="checkbox" checked={on} onChange={() => toggle(l.id, l.qty)} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="font-medium text-on-surface">{itemCode(l.item)}</span> <span className="text-on-surface-variant">{l.item.description}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right">{l.qty}</td>
                    <td className="py-1.5 text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={!on}
                        value={on ? picked[l.id] : ""}
                        onKeyDown={numericKeyGuard()}
                        onChange={(e) => setPicked((prev) => ({ ...prev, [l.id]: e.target.value }))}
                        className="w-16 rounded border border-surface-container-high px-1 py-0.5 text-right disabled:bg-surface-container-low"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-on-surface-variant">
            The new feeder is a custom feeder with the same feeder qty as this one. After saving, place it in GA Builder (it starts in the unassigned list).
            Check its device type and rating — they&apos;re copied from this feeder.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-surface-container-high px-5 py-3">
          <span className="text-xs text-error">{error}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-outline btn-sm">
              Cancel
            </button>
            <button onClick={() => onSplit(picks, name.trim())} disabled={!!error} className="btn btn-primary btn-sm">
              Split
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
