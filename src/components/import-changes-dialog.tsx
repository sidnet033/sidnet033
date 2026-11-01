"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import type { ItemUpdateChange } from "@/lib/item-import";

// Shown during an Item Master import before anything is written: every
// existing item the file would change, field by field (old -> new). Only
// the ticked items are updated; new items are created either way.
export function ImportChangesDialog({
  changes,
  newCount,
  onAccept,
  onCancel,
}: {
  changes: ItemUpdateChange[];
  newCount: number;
  onAccept: (ids: Set<string>) => void;
  onCancel: () => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(changes.map((c) => c.id)),
  );
  const [fieldFilter, setFieldFilter] = useState("");
  const fieldCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of changes)
      for (const f of c.fields) m.set(f.label, (m.get(f.label) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [changes]);
  const shown = fieldFilter
    ? changes.filter((c) => c.fields.some((f) => f.label === fieldFilter))
    : changes;

  function toggle(id: string) {
    setTicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <Modal
      title="Review changes to existing items"
      onClose={onCancel}
      width="max-w-6xl"
    >
      <div className="space-y-3 text-sm">
        <p className="text-[13px] text-secondary">
          This file changes <b className="text-on-surface">{changes.length}</b>{" "}
          existing item(s)
          {newCount > 0 ? (
            <>
              {" "}
              and adds <b className="text-on-surface">{newCount}</b> new one(s)
            </>
          ) : null}
          . Untick any item you don&apos;t want updated. New items are created
          either way; items the file doesn&apos;t change are left alone.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-secondary">Changed fields:</span>
          <button
            onClick={() => setFieldFilter("")}
            className={`rounded-full px-2 py-0.5 ${fieldFilter === "" ? "bg-primary font-bold text-on-primary" : "bg-surface-container-low"}`}
          >
            All ({changes.length})
          </button>
          {fieldCounts.map(([label, n]) => (
            <button
              key={label}
              onClick={() => setFieldFilter(label)}
              className={`rounded-full px-2 py-0.5 ${fieldFilter === label ? "bg-primary font-bold text-on-primary" : "bg-surface-container-low"}`}
            >
              {label} ({n})
            </button>
          ))}
          <span className="ml-auto flex gap-2">
            <button
              onClick={() => setTicked(new Set(changes.map((c) => c.id)))}
              className="text-primary hover:underline"
            >
              Tick all
            </button>
            <button
              onClick={() => setTicked(new Set())}
              className="text-primary hover:underline"
            >
              Untick all
            </button>
          </span>
        </div>
        <div className="max-h-[55vh] overflow-auto rounded border border-surface-container-high">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-secondary">
              <tr>
                <th className="w-8 px-2 py-1.5" />
                <th className="px-2 py-1.5">Row</th>
                <th className="px-2 py-1.5">Item</th>
                <th className="px-2 py-1.5">Field</th>
                <th className="px-2 py-1.5">Now</th>
                <th className="px-2 py-1.5">From the file</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) =>
                c.fields.map((f, i) => (
                  <tr
                    key={`${c.id}-${f.field}`}
                    className={`${i === 0 ? "border-t border-surface-container-high" : ""} ${ticked.has(c.id) ? "" : "opacity-50"}`}
                  >
                    {i === 0 && (
                      <>
                        <td
                          className="px-2 py-1 align-top"
                          rowSpan={c.fields.length}
                        >
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={ticked.has(c.id)}
                            onChange={() => toggle(c.id)}
                          />
                        </td>
                        <td
                          className="px-2 py-1 align-top text-secondary"
                          rowSpan={c.fields.length}
                        >
                          {c.rowNumber}
                        </td>
                        <td
                          className="max-w-72 px-2 py-1 align-top"
                          rowSpan={c.fields.length}
                        >
                          <span className="font-mono font-bold">{c.code}</span>
                          <span className="block text-secondary">
                            {c.description}
                          </span>
                        </td>
                      </>
                    )}
                    <td className="px-2 py-1 font-bold">{f.label}</td>
                    <td className="max-w-64 px-2 py-1 text-error line-through decoration-error/50">
                      {f.from}
                    </td>
                    <td className="max-w-64 px-2 py-1 font-bold text-emerald-700">
                      {f.to}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-secondary">
            {ticked.size} of {changes.length} update(s) accepted
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="btn btn-outline btn-sm"
              title="Stop the import — nothing is created or updated"
            >
              Cancel import
            </button>
            <button
              onClick={() => onAccept(ticked)}
              className="btn btn-primary btn-sm"
            >
              Import{newCount ? ` ${newCount} new +` : ""} update {ticked.size}{" "}
              item(s)
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
