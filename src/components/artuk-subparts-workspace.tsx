"use client";

import { Fragment, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";
import { subpartCost, type SteelRates } from "@/lib/steel-rates";
import { filterTerms } from "@/components/multi-filter";
import type { ArtukPartComponent, ArtukSubpart } from "@/types/database";

// ArTuK enclosure costing: each ABB part (Item Master SKU) is made of
// sub-parts. A GI / CRCA sub-part costs weight x the steel rate, anything
// else (bought-out, or steel with no weight on file) its own unit cost. The
// ABB part costs sum(qty x sub-part cost). Rates here are the app-wide
// defaults; a project can override them in Project Detail.
type ItemRow = {
  sku: string;
  description: string;
  unit_cost: number;
  status: string;
};
const MATERIALS = ["GI", "CRCA", "BO", ""] as const;
const matLabel = (m: string | null) =>
  m === "BO" ? "Bought-out" : m || "Not set";
const kg = (v: number | null) => (v == null ? "—" : `${Number(v).toFixed(3)}`);
const key = (s: string) => s.trim().toUpperCase();

export function ArtukSubpartsWorkspace({
  initialSubparts,
  initialComponents,
  initialRates,
  items,
  isAdmin,
}: {
  initialSubparts: ArtukSubpart[];
  initialComponents: ArtukPartComponent[];
  initialRates: SteelRates;
  items: ItemRow[];
  isAdmin: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [subparts, setSubparts] = useState(initialSubparts);
  const [components, setComponents] = useState(initialComponents);
  const [rates, setRates] = useState(initialRates);
  const [rateDraft, setRateDraft] = useState({
    GI: String(initialRates.GI),
    CRCA: String(initialRates.CRCA),
  });
  const [tab, setTab] = useState<"parts" | "subparts">("parts");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const subById = useMemo(
    () => new Map(subparts.map((s) => [s.id, s])),
    [subparts],
  );
  const itemBySku = useMemo(() => {
    const m = new Map<string, ItemRow>();
    for (const i of items)
      if (!m.has(key(i.sku)) || i.status === "active") m.set(key(i.sku), i);
    return m;
  }, [items]);
  const parts = useMemo(() => {
    const m = new Map<string, ArtukPartComponent[]>();
    for (const c of components)
      (m.get(c.parent_sku) ?? m.set(c.parent_sku, []).get(c.parent_sku)!).push(
        c,
      );
    return Array.from(m.entries())
      .map(([sku, lines]) => {
        lines.sort((a, b) => a.sort_order - b.sort_order);
        let cost = 0;
        let weight = 0;
        for (const l of lines) {
          const s = subById.get(l.subpart_id);
          if (!s) continue;
          cost += l.qty * subpartCost(s, rates);
          if (s.material === "GI" || s.material === "CRCA")
            weight += l.qty * Number(s.weight_kg ?? 0);
        }
        const incomplete = lines.some((l) => {
          const s = subById.get(l.subpart_id);
          return s && s.material == null;
        });
        return {
          sku,
          lines,
          cost,
          weight,
          incomplete,
          item: itemBySku.get(key(sku)),
        };
      })
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [components, subById, rates, itemBySku]);
  const usedIn = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of components)
      m.set(c.subpart_id, (m.get(c.subpart_id) ?? 0) + 1);
    return m;
  }, [components]);

  const terms = filterTerms(q);
  const hit = (...fields: (string | null | undefined)[]) =>
    terms.length === 0 ||
    terms.some((t) =>
      fields.some((f) => (f ?? "").toLowerCase().includes(t.toLowerCase())),
    );
  const shownParts = parts.filter((p) =>
    hit(
      p.sku,
      p.item?.description,
      ...p.lines.map((l) => subById.get(l.subpart_id)?.code),
    ),
  );
  const shownSubs = subparts.filter((s) =>
    hit(s.code, s.description, s.family, s.material),
  );

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function saveRates() {
    const GI = Number(rateDraft.GI);
    const CRCA = Number(rateDraft.CRCA);
    if (
      !(GI >= 0) ||
      !(CRCA >= 0) ||
      rateDraft.GI.trim() === "" ||
      rateDraft.CRCA.trim() === ""
    )
      return flash(false, "Enter both rates.");
    setBusy(true);
    const { error } = await supabase
      .from("app_settings")
      .update({
        enclosure_rate_gi: GI,
        enclosure_rate_crca: CRCA,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    setBusy(false);
    if (error) return flash(false, error.message);
    setRates({ GI, CRCA });
    flash(
      true,
      "Default rates saved. Item Master costs of ABB parts were recalculated; projects without their own rate use these.",
    );
  }

  async function updateSubpart(id: string, patch: Partial<ArtukSubpart>) {
    const { error } = await supabase
      .from("artuk_subparts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return flash(false, error.message);
    setSubparts((list) =>
      list.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  }

  async function updateQty(id: string, qty: number) {
    if (!(qty > 0)) return;
    const { error } = await supabase
      .from("artuk_part_components")
      .update({ qty })
      .eq("id", id);
    if (error) return flash(false, error.message);
    setComponents((list) => list.map((c) => (c.id === id ? { ...c, qty } : c)));
  }

  async function removeLine(id: string) {
    const { error } = await supabase
      .from("artuk_part_components")
      .delete()
      .eq("id", id);
    if (error) return flash(false, error.message);
    setComponents((list) => list.filter((c) => c.id !== id));
  }

  async function addLine(parentSku: string, code: string, qty: number) {
    const s = subparts.find((x) => key(x.code) === key(code));
    if (!s) return flash(false, `No sub-part "${code}".`);
    const lines = components.filter((c) => c.parent_sku === parentSku);
    if (lines.some((c) => c.subpart_id === s.id))
      return flash(
        false,
        `${s.code} is already in ${parentSku} — change its qty instead.`,
      );
    const { data, error } = await supabase
      .from("artuk_part_components")
      .insert({
        parent_sku: parentSku,
        subpart_id: s.id,
        qty,
        sort_order: lines.length,
      })
      .select("*")
      .single();
    if (error) return flash(false, error.message);
    setComponents((list) => [...list, data as ArtukPartComponent]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-sm font-bold text-on-surface">
            ArTuK Sub-parts
          </h1>
          <p className="max-w-3xl text-body-sm text-secondary">
            Each ABB enclosure part is built from sub-parts. A GI / CRCA
            sub-part costs <b>Total Wt. × steel rate</b>; bought-out parts
            (gaskets, glass, screws…) and steel parts with no weight on file use
            their own cost. The ABB part&apos;s cost is the sum of qty ×
            sub-part cost, and is written back to Item Master at the default
            rates. Source: ArTuK Fabrication BOM 29-05-2026 (Max Part Costs +
            Part Costs “Total Wt.”).
          </p>
        </div>
        <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-3">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-secondary">
            Default steel rates (INR/kg)
          </div>
          <div className="flex items-end gap-2">
            {(["GI", "CRCA"] as const).map((m) => (
              <label
                key={m}
                className="text-[12px] font-bold text-on-surface-variant"
              >
                {m}
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={!isAdmin}
                  value={rateDraft[m]}
                  onChange={(e) =>
                    setRateDraft((d) => ({ ...d, [m]: e.target.value }))
                  }
                  className="ml-1 w-20 rounded border border-surface-container-high bg-surface-container-lowest px-2 py-1 text-center text-body-sm disabled:bg-surface-container-low"
                />
              </label>
            ))}
            {isAdmin && (
              <button
                onClick={saveRates}
                disabled={
                  busy ||
                  (Number(rateDraft.GI) === rates.GI &&
                    Number(rateDraft.CRCA) === rates.CRCA)
                }
                className="btn btn-primary btn-sm"
              >
                {busy ? "Saving..." : "Save"}
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-secondary">
            {isAdmin
              ? "Used by every project that hasn't set its own rate."
              : "Only an admin can change these."}
          </p>
        </div>
      </div>

      {msg && (
        <p
          className={`text-body-sm ${msg.ok ? "text-emerald-700" : "text-error"}`}
        >
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["parts", `ABB parts (${parts.length})`],
            ["subparts", `Sub-parts (${subparts.length})`],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`btn btn-sm ${tab === t ? "btn-primary" : "btn-outline"}`}
          >
            {label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search code / description — use | for several, e.g. SK6010|RF2060"
          className="ml-auto w-96 rounded border border-surface-container-high bg-surface-container-lowest px-3 py-1.5 text-body-sm"
        />
      </div>

      {tab === "parts" ? (
        <div className="overflow-auto rounded border border-surface-container-high">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-secondary">
              <tr>
                <th className="px-2 py-1.5">ABB part</th>
                <th className="px-2 py-1.5">Description (Item Master)</th>
                <th className="px-2 py-1.5 text-center">Sub-parts</th>
                <th className="px-2 py-1.5 text-right">Steel wt (kg)</th>
                <th className="px-2 py-1.5 text-right">Cost @ default rates</th>
                <th className="px-2 py-1.5 text-right">Item Master cost</th>
              </tr>
            </thead>
            <tbody>
              {shownParts.map((p) => {
                const isOpen = open.has(p.sku);
                return (
                  <Fragment key={p.sku}>
                    <tr
                      className="cursor-pointer border-t border-surface-container hover:bg-surface-container-low"
                      onClick={() =>
                        setOpen((s) => {
                          const n = new Set(s);
                          if (n.has(p.sku)) n.delete(p.sku);
                          else n.add(p.sku);
                          return n;
                        })
                      }
                    >
                      <td className="px-2 py-1 font-bold text-primary">
                        {isOpen ? "▾" : "▸"} {p.sku}
                      </td>
                      <td className="px-2 py-1">
                        {p.item?.description ?? (
                          <span className="text-error">Not in Item Master</span>
                        )}
                        {p.incomplete && (
                          <span className="ml-2 rounded bg-amber-100 px-1 text-[10px] text-amber-900">
                            has steel part with no weight
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {p.lines.length}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {p.weight ? p.weight.toFixed(3) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right font-bold">
                        {formatMoney(p.cost)}
                      </td>
                      <td className="px-2 py-1 text-right text-secondary">
                        {p.item ? formatMoney(Number(p.item.unit_cost)) : "—"}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface-container-lowest">
                        <td colSpan={6} className="px-6 py-2">
                          <PartLines
                            part={p}
                            subById={subById}
                            rates={rates}
                            isAdmin={isAdmin}
                            subparts={subparts}
                            onQty={updateQty}
                            onRemove={removeLine}
                            onAdd={addLine}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-auto rounded border border-surface-container-high">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-secondary">
              <tr>
                <th className="px-2 py-1.5">Sub-part</th>
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5">Material</th>
                <th className="px-2 py-1.5 text-right">Total Wt. (kg)</th>
                <th className="px-2 py-1.5 text-right">
                  Own cost (bought-out / no weight)
                </th>
                <th className="px-2 py-1.5 text-right">Cost each @ default</th>
                <th className="px-2 py-1.5 text-right">xls cost</th>
                <th className="px-2 py-1.5 text-center">Used in</th>
                <th className="px-2 py-1.5">Source / notes</th>
              </tr>
            </thead>
            <tbody>
              {shownSubs.map((s) => (
                <tr
                  key={s.id}
                  className={`border-t border-surface-container ${s.material == null ? "bg-amber-50/60" : ""}`}
                >
                  <td className="px-2 py-1 font-bold">{s.code}</td>
                  <td className="px-2 py-1">{s.description}</td>
                  <td className="px-2 py-1">
                    {isAdmin ? (
                      <select
                        value={s.material ?? ""}
                        onChange={(e) =>
                          updateSubpart(s.id, {
                            material: (e.target.value ||
                              null) as ArtukSubpart["material"],
                          })
                        }
                        className="rounded border border-surface-container-high bg-surface-container-lowest px-1 py-0.5"
                      >
                        {MATERIALS.map((m) => (
                          <option key={m} value={m}>
                            {matLabel(m || null)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      matLabel(s.material)
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {isAdmin ? (
                      <NumberCell
                        value={s.weight_kg}
                        allowBlank
                        onCommit={(v) => updateSubpart(s.id, { weight_kg: v })}
                      />
                    ) : (
                      kg(s.weight_kg)
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {isAdmin ? (
                      <NumberCell
                        value={s.unit_cost}
                        onCommit={(v) =>
                          updateSubpart(s.id, { unit_cost: v ?? 0 })
                        }
                      />
                    ) : (
                      formatMoney(Number(s.unit_cost))
                    )}
                  </td>
                  <td className="px-2 py-1 text-right font-bold">
                    {formatMoney(subpartCost(s, rates))}
                  </td>
                  <td className="px-2 py-1 text-right text-secondary">
                    {s.xls_cost != null ? formatMoney(Number(s.xls_cost)) : "—"}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {usedIn.get(s.id) ?? 0}
                  </td>
                  <td className="px-2 py-1 text-[11px] text-secondary">
                    {s.source}
                    {s.notes && (
                      <span className="block text-amber-800">{s.notes}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PartLines({
  part,
  subById,
  rates,
  isAdmin,
  subparts,
  onQty,
  onRemove,
  onAdd,
}: {
  part: { sku: string; lines: ArtukPartComponent[]; cost: number };
  subById: Map<string, ArtukSubpart>;
  rates: SteelRates;
  isAdmin: boolean;
  subparts: ArtukSubpart[];
  onQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onAdd: (parentSku: string, code: string, qty: number) => void;
}) {
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("1");
  return (
    <div className="space-y-2">
      <table className="w-full border-collapse text-[12px]">
        <thead className="text-left text-[11px] uppercase tracking-wider text-secondary">
          <tr>
            <th className="py-1 pr-2">Sub-part</th>
            <th className="py-1 pr-2">Description</th>
            <th className="py-1 pr-2">Material</th>
            <th className="py-1 pr-2 text-right">Total Wt. (kg)</th>
            <th className="py-1 pr-2 text-right">Cost each</th>
            <th className="py-1 pr-2 text-center">Qty</th>
            <th className="py-1 pr-2 text-right">Amount</th>
            {isAdmin && <th />}
          </tr>
        </thead>
        <tbody>
          {part.lines.map((l) => {
            const s = subById.get(l.subpart_id);
            if (!s) return null;
            const each = subpartCost(s, rates);
            const byWeight =
              (s.material === "GI" || s.material === "CRCA") &&
              Number(s.weight_kg ?? 0) > 0;
            return (
              <tr key={l.id} className="border-t border-surface-container">
                <td className="py-1 pr-2 font-bold">{s.code}</td>
                <td className="py-1 pr-2">{s.description}</td>
                <td className="py-1 pr-2">{matLabel(s.material)}</td>
                <td className="py-1 pr-2 text-right">{kg(s.weight_kg)}</td>
                <td
                  className="py-1 pr-2 text-right"
                  title={
                    byWeight
                      ? `${s.weight_kg} kg × ₹${rates[s.material as "GI" | "CRCA"]}/kg`
                      : "Own cost"
                  }
                >
                  {formatMoney(each)}
                  <span className="block text-[10px] text-secondary">
                    {byWeight
                      ? `${Number(s.weight_kg).toFixed(3)} kg × ₹${rates[s.material as "GI" | "CRCA"]}`
                      : "own cost"}
                  </span>
                </td>
                <td className="py-1 pr-2 text-center">
                  {isAdmin ? (
                    <NumberCell
                      value={l.qty}
                      onCommit={(v) => v != null && onQty(l.id, v)}
                    />
                  ) : (
                    l.qty
                  )}
                </td>
                <td className="py-1 pr-2 text-right">
                  {formatMoney(each * l.qty)}
                </td>
                {isAdmin && (
                  <td className="py-1 text-right">
                    <button
                      onClick={() => onRemove(l.id)}
                      className="text-[11px] text-error hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
          <tr className="border-t-2 border-primary">
            <td colSpan={6} className="py-1 pr-2 text-right font-bold">
              {part.sku} total
            </td>
            <td className="py-1 pr-2 text-right font-bold text-primary">
              {formatMoney(part.cost)}
            </td>
            {isAdmin && <td />}
          </tr>
        </tbody>
      </table>
      {isAdmin && (
        <div className="flex items-center gap-2 text-[12px]">
          <input
            list={`subparts-${part.sku}`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Add sub-part (code)"
            className="w-72 rounded border border-surface-container-high bg-surface-container-lowest px-2 py-1"
          />
          <datalist id={`subparts-${part.sku}`}>
            {subparts.map((s) => (
              <option key={s.id} value={s.code}>
                {s.description}
              </option>
            ))}
          </datalist>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="decimal"
            className="w-16 rounded border border-surface-container-high bg-surface-container-lowest px-2 py-1 text-center"
          />
          <button
            onClick={() => {
              if (code.trim() && Number(qty) > 0) {
                onAdd(part.sku, code.trim(), Number(qty));
                setCode("");
                setQty("1");
              }
            }}
            className="btn btn-outline btn-sm"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function NumberCell({
  value,
  allowBlank = false,
  onCommit,
}: {
  value: number | null;
  allowBlank?: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [local, setLocal] = useState(value == null ? "" : String(value));
  return (
    <input
      value={local}
      inputMode="decimal"
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const t = local.trim();
        if (t === "" && allowBlank) {
          if (value != null) onCommit(null);
          return;
        }
        const n = Number(t);
        if (Number.isFinite(n) && n >= 0) {
          if (n !== Number(value)) onCommit(n);
        } else setLocal(value == null ? "" : String(value));
      }}
      className="w-20 rounded border border-surface-container-high bg-surface-container-lowest px-1 py-0.5 text-right"
    />
  );
}
