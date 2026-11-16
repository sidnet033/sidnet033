"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modal";
import { Icon } from "@/components/icon";
import { createClient } from "@/lib/supabase/client";
import {
  loadEnclosureTakeoff,
  type EnclosureTakeoff,
} from "@/lib/artuk-enclosure";
import { formatMoney } from "@/lib/money";
import type { Switchboard } from "@/types/database";

type Row = {
  code: string;
  description: string;
  qty: number;
  rate: number;
  amount: number;
  sharedWith: string[];
};

// Right-click a bay -> "Enclosure parts…": the ArTuK enclosure parts for
// that one bay (code, description, qty, rate, amount), from the saved GA,
// with a button that copies the table as tab-separated text for Excel.
// Parts for the whole panel (side panels, lifting, couplings) aren't any
// one bay's; a workbook pair (e.g. 920 + 420) is listed for both bays.
export function BayEnclosureDialog({
  switchboardId,
  bayId,
  bayName,
  bayNames,
  stale,
  onClose,
}: {
  switchboardId: string;
  bayId: string;
  bayName: string;
  /** bay id -> name, for "shared with" notes */
  bayNames: Map<string, string>;
  /** the GA has unsaved changes (the list shows the saved GA) */
  stale: boolean;
  onClose: () => void;
}) {
  const [takeoff, setTakeoff] = useState<EnclosureTakeoff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: sb, error: e } = await supabase
          .from("switchboards")
          .select("*")
          .eq("id", switchboardId)
          .single();
        if (e || !sb) throw new Error(e?.message ?? "Switchboard not found.");
        const t = await loadEnclosureTakeoff(supabase, sb as Switchboard);
        if (!cancelled) {
          if (!t) setError("Enclosure parts are listed for ArTuK boards only.");
          else setTakeoff(t);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [switchboardId]);

  const rows: Row[] = (takeoff?.lines ?? []).flatMap((l) => {
    const entries = (l.byBay ?? []).filter((e) => e.bayIds.includes(bayId));
    if (entries.length === 0) return [];
    const qty = entries.reduce((s, e) => s + e.qty, 0);
    const sharedWith = [
      ...new Set(
        entries
          .flatMap((e) => e.bayIds)
          .filter((id) => id !== bayId)
          .map((id) => bayNames.get(id) ?? "another bay"),
      ),
    ];
    return [
      {
        code: l.code,
        description: l.description,
        qty,
        rate: l.rate,
        amount: l.rate * qty,
        sharedWith,
      },
    ];
  });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const anyShared = rows.some((r) => r.sharedWith.length > 0);

  function copy() {
    const lines = [
      ["Part code", "Description", "Qty", "Rate (INR)", "Amount (INR)", ...(anyShared ? ["Shared with"] : [])],
      ...rows.map((r) => [
        r.code,
        r.description,
        String(r.qty),
        r.rate.toFixed(2),
        r.amount.toFixed(2),
        ...(anyShared ? [r.sharedWith.join(", ")] : []),
      ]),
      ["", "Total", "", "", total.toFixed(2)],
    ];
    const tsv = lines
      .map((cells) => cells.map((c) => c.replace(/[\t\n]/g, " ")).join("\t"))
      .join("\n");
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Modal
      title={`Enclosure parts — ${bayName}`}
      onClose={onClose}
      width="max-w-4xl"
    >
      {stale && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          The GA has unsaved changes — this list is for the last saved GA.
          Save to update it.
        </p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
      {!error && !takeoff && (
        <p className="text-sm text-on-surface-variant">Working it out…</p>
      )}
      {takeoff && rows.length === 0 && (
        <p className="text-sm text-on-surface-variant">
          No enclosure parts listed for this bay (save the GA if it&rsquo;s
          new).
        </p>
      )}
      {takeoff && rows.length > 0 && (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-on-surface-variant">
              {rows.length} parts. Panel-wide parts (side panels, lifting,
              couplings) aren&rsquo;t included.
            </p>
            <button
              type="button"
              onClick={copy}
              className="btn btn-outline btn-sm"
            >
              <Icon name={copied ? "check" : "content_copy"} size={14} />
              {copied ? "Copied" : "Copy for Excel"}
            </button>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-surface-container-high text-left text-secondary">
                <th className="py-1 pr-2">Part code</th>
                <th className="py-1 pr-2">Description</th>
                <th className="py-1 pr-2 text-right">Qty</th>
                <th className="py-1 pr-2 text-right">Rate</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.code}
                  className="border-b border-surface-container"
                >
                  <td className="py-1 pr-2 font-mono">{r.code}</td>
                  <td className="py-1 pr-2">
                    {r.description}
                    {r.sharedWith.length > 0 && (
                      <span className="ml-1 text-[10px] text-on-surface-variant">
                        (with {r.sharedWith.join(", ")})
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right">{r.qty}</td>
                  <td
                    className={`py-1 pr-2 text-right ${r.rate > 0 ? "" : "text-error"}`}
                  >
                    {r.rate > 0 ? formatMoney(r.rate) : "no price"}
                  </td>
                  <td className="py-1 text-right">{formatMoney(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-1.5" colSpan={4}>
                  Total
                </td>
                <td className="py-1.5 text-right">{formatMoney(total)}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </Modal>
  );
}
