"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/modal";
import type { DuplicateGroup } from "@/lib/item-duplicates";
import type { ItemMaster } from "@/types/database";
import { effectiveNetRate } from "@/lib/feeder-cost";

// One suspected-duplicate group at a time, items side by side. The user
// picks the ONE item to keep, can copy any field from the others into it,
// and the rest are archived. Optionally, library feeders that use the
// archived items are switched to the kept one.
type FieldKey = keyof ItemMaster;
const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "sku", label: "SKU" },
  { key: "vendor_cat", label: "Vendor Cat #" },
  { key: "description", label: "Description" },
  { key: "make", label: "Make" },
  { key: "category", label: "Category" },
  { key: "amps", label: "Amps" },
  { key: "frame", label: "Frame" },
  { key: "ka", label: "kA" },
  { key: "poles", label: "Poles" },
  { key: "uom", label: "UOM" },
  { key: "list_price", label: "List price" },
  { key: "discount_pct", label: "Discount %" },
  { key: "unit_cost", label: "Net cost" },
  { key: "mrp_or_lp", label: "MRP or LP" },
  { key: "supplier", label: "Supplier" },
  { key: "hsn_code", label: "HSN code" },
  { key: "material", label: "Material" },
  { key: "weight_kg", label: "Weight (kg)" },
  { key: "source", label: "Source" },
  { key: "vendor_description", label: "Vendor description" },
  { key: "notes", label: "Notes" },
];
const show = (v: unknown) => (v == null || v === "" ? "—" : String(v));
const same = (a: unknown, b: unknown) =>
  show(a).trim().toLowerCase() === show(b).trim().toLowerCase();

type Usage = { library: number; projects: number };

export function DuplicateResolverDialog({
  groups: initialGroups,
  onResolved,
  onClose,
}: {
  groups: DuplicateGroup[];
  onResolved: () => void;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  // snapshot: the list stays put while resolved groups drop out of Item Master behind it
  const [groups] = useState(initialGroups);
  const [index, setIndex] = useState(0);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const group = groups[index];
  const [keepId, setKeepId] = useState<string>(group?.items[0]?.id ?? "");
  // field -> id of the item whose value the kept item takes
  const [take, setTake] = useState<Partial<Record<FieldKey, string>>>({});
  const [usage, setUsage] = useState<Map<string, Usage>>(new Map());
  const [repoint, setRepoint] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function goTo(i: number) {
    setIndex(i);
    setKeepId(groups[i]?.items[0]?.id ?? "");
    setTake({});
    setError(null);
  }

  // where each item in the group is used (library feeders / project feeders)
  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    (async () => {
      const ids = group.items.map((i) => i.id);
      const { data } = await supabase
        .from("feeder_items")
        .select("item_id, feeder:feeders(is_library)")
        .in("item_id", ids);
      const m = new Map<string, Usage>(
        ids.map((id) => [id, { library: 0, projects: 0 }]),
      );
      for (const r of (data ?? []) as unknown as {
        item_id: string;
        feeder: { is_library: boolean } | null;
      }[]) {
        const u = m.get(r.item_id)!;
        if (r.feeder?.is_library) u.library++;
        else u.projects++;
      }
      if (!cancelled) setUsage(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, group]);

  if (!group) return null;
  const keep = group.items.find((i) => i.id === keepId) ?? group.items[0];
  const others = group.items.filter((i) => i.id !== keep.id);
  const valueFor = (f: FieldKey) => {
    const src = take[f] ? group.items.find((i) => i.id === take[f]) : keep;
    return (src ?? keep)[f];
  };
  const differs = (f: FieldKey) =>
    group.items.some((i) => !same(i[f], group.items[0][f]));
  const libLinesToMove = others.reduce(
    (n, i) => n + (usage.get(i.id)?.library ?? 0),
    0,
  );

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      for (const [f, src] of Object.entries(take)) {
        const from = group.items.find((i) => i.id === src);
        if (from && src !== keep.id) patch[f] = from[f as FieldKey];
      }
      if (
        ("list_price" in patch || "discount_pct" in patch) &&
        !("unit_cost" in patch)
      ) {
        const merged = { ...keep, ...patch } as ItemMaster;
        patch.unit_cost = effectiveNetRate(merged);
      }
      if (Object.keys(patch).length) {
        const { error: e1 } = await supabase
          .from("item_master")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", keep.id);
        if (e1) throw e1;
      }
      const otherIds = others.map((i) => i.id);
      if (repoint && libLinesToMove > 0) {
        // library feeders only -- project BOMs keep exactly what was quoted
        const { data: libFeeders } = await supabase
          .from("feeders")
          .select("id")
          .eq("is_library", true);
        const libIds = (libFeeders ?? []).map((f) => f.id as string);
        for (let i = 0; i < libIds.length; i += 200) {
          const { error: e2 } = await supabase
            .from("feeder_items")
            .update({ item_id: keep.id })
            .in("item_id", otherIds)
            .in("feeder_id", libIds.slice(i, i + 200));
          if (e2) throw e2;
        }
      }
      const { error: e3 } = await supabase
        .from("item_master")
        .update({
          status: "discontinued",
          updated_at: new Date().toISOString(),
        })
        .in("id", otherIds);
      if (e3) throw e3;
      setDoneKeys((prev) => new Set(prev).add(group.key));
      onResolved();
      const next = groups.findIndex(
        (g, i) => i > index && !doneKeys.has(g.key),
      );
      if (next >= 0) goTo(next);
      else onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not resolve this group.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Suspected duplicates — group ${index + 1} of ${groups.length}`}
      onClose={onClose}
      width="max-w-7xl"
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-900">
          <b>Why these look like duplicates:</b>
          <ul className="mt-0.5 list-disc pl-5">
            {group.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] text-secondary">
          Pick the <b>one item to keep</b>. To bring a value over from another
          item, click it — it becomes the kept item&apos;s value (shown in
          blue). The other items are archived (not deleted). Rows where the
          items differ are highlighted.
        </p>

        <div className="max-h-[52vh] overflow-auto rounded border border-surface-container-high">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-surface-container-low">
              <tr>
                <th className="w-36 px-2 py-1.5 text-left text-[11px] uppercase tracking-wider text-secondary">
                  Field
                </th>
                {group.items.map((i) => (
                  <th
                    key={i.id}
                    className={`min-w-48 border-l border-surface-container-high px-2 py-1.5 text-left ${i.id === keep.id ? "bg-primary/10" : ""}`}
                  >
                    <label className="flex cursor-pointer items-center gap-1.5 font-bold">
                      <input
                        type="radio"
                        name="keep"
                        className="accent-primary"
                        checked={i.id === keep.id}
                        onChange={() => (setKeepId(i.id), setTake({}))}
                      />
                      {i.id === keep.id ? "Keep this" : "Archive"}
                    </label>
                    <span className="block text-[11px] font-normal text-secondary">
                      Used in {usage.get(i.id)?.library ?? 0} library /{" "}
                      {usage.get(i.id)?.projects ?? 0} project feeder line(s)
                    </span>
                  </th>
                ))}
                <th className="min-w-48 border-l-2 border-primary px-2 py-1.5 text-left text-primary">
                  Result (kept item)
                </th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map(({ key, label }) => {
                const diff = differs(key);
                return (
                  <tr
                    key={key}
                    className={`border-t border-surface-container ${diff ? "bg-amber-50/60" : ""}`}
                  >
                    <td className="px-2 py-1 font-bold text-on-surface-variant">
                      {label}
                    </td>
                    {group.items.map((i) => {
                      const chosen = (take[key] ?? keep.id) === i.id;
                      const canTake =
                        i.id !== keep.id && diff && !same(i[key], keep[key]);
                      return (
                        <td
                          key={i.id}
                          className={`border-l border-surface-container-high px-2 py-1 ${i.id === keep.id ? "bg-primary/5" : ""}`}
                        >
                          {canTake ? (
                            <button
                              type="button"
                              onClick={() =>
                                setTake((t) => ({
                                  ...t,
                                  [key]: chosen ? undefined : i.id,
                                }))
                              }
                              title={
                                chosen
                                  ? "Click to undo"
                                  : "Use this value in the kept item"
                              }
                              className={`rounded px-1 text-left ${chosen ? "bg-primary text-on-primary" : "underline decoration-dotted hover:bg-primary/10"}`}
                            >
                              {show(i[key])}
                            </button>
                          ) : (
                            <span className={chosen && take[key] ? "" : ""}>
                              {show(i[key])}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td
                      className={`border-l-2 border-primary px-2 py-1 ${take[key] ? "font-bold text-primary" : ""}`}
                    >
                      {show(valueFor(key))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {libLinesToMove > 0 && (
          <label className="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              className="accent-primary"
              checked={repoint}
              onChange={(e) => setRepoint(e.target.checked)}
            />
            Switch the {libLinesToMove} library feeder line(s) that use the
            archived item(s) to the kept item (project BOMs are not changed)
          </label>
        )}
        {error && <p className="text-[12px] text-error">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-container pt-3">
          <div className="flex gap-2">
            <button
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              className="btn btn-outline btn-sm"
            >
              ‹ Previous
            </button>
            <button
              onClick={() => goTo(index + 1)}
              disabled={index >= groups.length - 1}
              className="btn btn-outline btn-sm"
            >
              Skip / next ›
            </button>
            {doneKeys.has(group.key) && (
              <span className="self-center text-[12px] text-emerald-700">
                Resolved
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-outline btn-sm">
              Close
            </button>
            <button
              onClick={resolve}
              disabled={busy || doneKeys.has(group.key)}
              className="btn btn-primary btn-sm"
            >
              {busy
                ? "Saving..."
                : `Keep 1, archive ${others.length}${Object.keys(take).filter((k) => take[k as FieldKey]).length ? ` (+${Object.keys(take).filter((k) => take[k as FieldKey]).length} copied value(s))` : ""}`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
