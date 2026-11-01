"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/modal";
import { effectiveNetRate } from "@/lib/feeder-cost";
import { itemCode } from "@/lib/item-display";
import { formatMoney } from "@/lib/money";
import type { ItemMaster } from "@/types/database";

// Estimation Head (or admin), project Quoted or later: take the list price /
// discount used on this revision's feeder lines and write them into the
// Item Master. Rates HIGHER than the Item Master's are flagged and left
// unticked -- the Estimation Head decides whether to take them.
type Variant = {
  key: string;
  lp: number | null;
  disc: number | null;
  net: number;
  lines: number;
  feeders: Set<string>;
};
type Row = { item: ItemMaster; masterNet: number; variants: Variant[] };

const money = (n: number | null) => (n == null ? "—" : formatMoney(n));
const pct = (n: number | null) => (n == null ? "—" : `${Number(n)}%`);

export function ItemRateSyncDialog({
  revisionId,
  switchboardIds,
  projectLabel,
  onClose,
}: {
  revisionId: string;
  switchboardIds: string[];
  projectLabel: string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Map<string, string>>(new Map()); // item id -> variant key
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [onlyHigher, setOnlyHigher] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: feeders, error: fe } = switchboardIds.length
          ? await supabase
              .from("feeders")
              .select("id, name")
              .in("switchboard_id", switchboardIds)
          : { data: [], error: null };
        if (fe) throw fe;
        const names = new Map(
          (feeders ?? []).map((f) => [f.id as string, f.name as string]),
        );
        const ids = [...names.keys()];
        const { data: lines, error: le } = ids.length
          ? await supabase
              .from("feeder_items")
              .select(
                "feeder_id, list_price_override, discount_pct_override, item:item_master(*)",
              )
              .in("feeder_id", ids)
              .or(
                "list_price_override.not.is.null,discount_pct_override.not.is.null",
              )
          : { data: [], error: null };
        if (le) throw le;
        const byItem = new Map<string, Row>();
        for (const l of (lines ?? []) as unknown as {
          feeder_id: string;
          list_price_override: number | null;
          discount_pct_override: number | null;
          item: ItemMaster | null;
        }[]) {
          const item = l.item;
          if (!item) continue;
          const lp = l.list_price_override ?? item.list_price;
          const disc = l.discount_pct_override ?? item.discount_pct;
          // same as the Item Master already -- nothing to update
          if (
            Number(lp ?? NaN) === Number(item.list_price ?? NaN) &&
            Number(disc ?? NaN) === Number(item.discount_pct ?? NaN)
          )
            continue;
          if (lp == null && disc == null) continue;
          const key = `${lp ?? ""}|${disc ?? ""}`;
          let row = byItem.get(item.id);
          if (!row) {
            row = { item, masterNet: effectiveNetRate(item), variants: [] };
            byItem.set(item.id, row);
          }
          let v = row.variants.find((x) => x.key === key);
          if (!v) {
            v = {
              key,
              lp: lp == null ? null : Number(lp),
              disc: disc == null ? null : Number(disc),
              net: effectiveNetRate(item, lp, disc),
              lines: 0,
              feeders: new Set(),
            };
            row.variants.push(v);
          }
          v.lines++;
          v.feeders.add(names.get(l.feeder_id) ?? "feeder");
        }
        const list = [...byItem.values()].map((r) => ({
          ...r,
          variants: r.variants.sort((a, b) => b.lines - a.lines),
        }));
        list.sort((a, b) => itemCode(a.item).localeCompare(itemCode(b.item)));
        if (cancelled) return;
        setRows(list);
        setPick(new Map(list.map((r) => [r.item.id, r.variants[0].key])));
        // rates higher than the Item Master start unticked
        setTicked(
          new Set(
            list
              .filter((r) => r.variants[0].net <= r.masterNet + 0.005)
              .map((r) => r.item.id),
          ),
        );
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : "Could not load the project's rates.",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, switchboardIds]);

  const chosen = (r: Row) =>
    r.variants.find((v) => v.key === pick.get(r.item.id)) ?? r.variants[0];
  const isHigher = (r: Row) => chosen(r).net > r.masterNet + 0.005;
  const shown = (rows ?? []).filter((r) => !onlyHigher || isHigher(r));
  const higherCount = (rows ?? []).filter(isHigher).length;
  const tickedHigher = (rows ?? []).filter(
    (r) => ticked.has(r.item.id) && isHigher(r),
  ).length;

  async function apply() {
    if (!rows) return;
    const sel = rows.filter((r) => ticked.has(r.item.id));
    if (!sel.length) return;
    if (
      tickedHigher > 0 &&
      !confirm(
        `${tickedHigher} of the ticked rate(s) are HIGHER than the Item Master. Update them anyway?`,
      )
    )
      return;
    setBusy(true);
    const { data, error } = await supabase.rpc(
      "update_item_master_rates_from_revision",
      {
        p_revision_id: revisionId,
        p_rows: sel.map((r) => ({
          item_id: r.item.id,
          list_price: chosen(r).lp,
          discount_pct: chosen(r).disc,
        })),
      },
    );
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    alert(
      `Item Master updated for ${(data as { items: number }).items} item(s). Everyone now gets these rates for new feeders and on "Refresh items".`,
    );
    onClose();
  }

  return (
    <Modal
      title={`Update Item Master rates — ${projectLabel}`}
      onClose={onClose}
      width="max-w-6xl"
    >
      <div className="space-y-3 text-sm">
        <p className="text-[13px] text-secondary">
          Rates (list price / discount) set on this revision&apos;s feeder lines
          that differ from the Item Master. Tick the ones to copy into the Item
          Master; other users then get them. Rates{" "}
          <b className="text-amber-800">higher</b> than the Item Master are
          highlighted and start unticked.
        </p>
        {error && <p className="text-error">{error}</p>}
        {!rows && !error && (
          <p className="text-secondary">Loading the project&apos;s rates…</p>
        )}
        {rows && rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-surface-container-high py-8 text-center text-secondary">
            Every item in this revision already uses the Item Master&apos;s rate
            — nothing to update.
          </p>
        )}
        {rows && rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-[12px]">
              <span>
                {rows.length} item(s) with project rates ·{" "}
                <b className={higherCount ? "text-amber-800" : ""}>
                  {higherCount} higher than Item Master
                </b>
              </span>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={onlyHigher}
                  onChange={(e) => setOnlyHigher(e.target.checked)}
                  className="accent-primary"
                />
                Show only higher rates
              </label>
              <span className="ml-auto flex gap-2">
                <button
                  onClick={() =>
                    setTicked(
                      new Set(
                        rows.filter((r) => !isHigher(r)).map((r) => r.item.id),
                      ),
                    )
                  }
                  className="text-primary hover:underline"
                >
                  Tick all except higher
                </button>
                <button
                  onClick={() => setTicked(new Set(rows.map((r) => r.item.id)))}
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
                    <th className="px-2 py-1.5" />
                    <th className="px-2 py-1.5">Item</th>
                    <th className="px-2 py-1.5 text-right">
                      Item Master LP / Disc
                    </th>
                    <th className="px-2 py-1.5 text-right">Item Master net</th>
                    <th className="px-2 py-1.5 text-right">
                      Project LP / Disc
                    </th>
                    <th className="px-2 py-1.5 text-right">Project net</th>
                    <th className="px-2 py-1.5">Used in</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const v = chosen(r);
                    const higher = isHigher(r);
                    return (
                      <tr
                        key={r.item.id}
                        className={`border-t border-surface-container ${higher ? "bg-amber-50" : ""}`}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={ticked.has(r.item.id)}
                            onChange={() =>
                              setTicked((prev) => {
                                const n = new Set(prev);
                                if (n.has(r.item.id)) n.delete(r.item.id);
                                else n.add(r.item.id);
                                return n;
                              })
                            }
                          />
                        </td>
                        <td className="max-w-80 px-2 py-1.5">
                          <span className="font-mono font-bold">
                            {itemCode(r.item)}
                          </span>
                          <span className="ml-1.5 text-secondary">
                            {r.item.description}
                          </span>
                          {higher && (
                            <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                              Higher
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                          {money(r.item.list_price)} /{" "}
                          {pct(r.item.discount_pct)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                          {money(r.masterNet)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                          {r.variants.length > 1 ? (
                            <select
                              value={v.key}
                              onChange={(e) =>
                                setPick((prev) =>
                                  new Map(prev).set(r.item.id, e.target.value),
                                )
                              }
                              className="rounded border border-surface-container-high px-1 py-0.5 text-[12px]"
                              title="This item has different rates on different feeders — pick the one to use"
                            >
                              {r.variants.map((x) => (
                                <option key={x.key} value={x.key}>
                                  {money(x.lp)} / {pct(x.disc)} ({x.lines} line
                                  {x.lines === 1 ? "" : "s"})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <>
                              {money(v.lp)} / {pct(v.disc)}
                            </>
                          )}
                        </td>
                        <td
                          className={`whitespace-nowrap px-2 py-1.5 text-right font-bold tabular-nums ${higher ? "text-amber-800" : "text-emerald-700"}`}
                        >
                          {money(v.net)}
                        </td>
                        <td
                          className="max-w-56 truncate px-2 py-1.5 text-secondary"
                          title={[...v.feeders].join(", ")}
                        >
                          {[...v.feeders].join(", ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-secondary">
                {ticked.size} ticked
                {tickedHigher ? ` (${tickedHigher} higher)` : ""} · every change
                is logged in Admin Space → Price Update Log
              </p>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn btn-outline btn-sm">
                  Cancel
                </button>
                <button
                  onClick={apply}
                  disabled={busy || ticked.size === 0}
                  className="btn btn-primary btn-sm"
                >
                  {busy
                    ? "Updating..."
                    : `Update ${ticked.size} item(s) in Item Master`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
