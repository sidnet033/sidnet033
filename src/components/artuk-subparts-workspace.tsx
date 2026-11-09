"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";
import { subpartBreakdown, type Rates } from "@/lib/enclosure-rates";
import { filterTerms } from "@/components/multi-filter";
import { Modal } from "@/components/modal";
import { EnclosureRatesDialog } from "@/components/enclosure-rates-dialog";
import type { ArtukPartComponent, ArtukSubpart } from "@/types/database";

// ArTuK enclosure costing. Each ABB part (Item Master SKU) is made of
// sub-parts; each fabricated sub-part is costed like the fabrication BOM's
// "Total Cost with KG calculation" from the Enclosure Rates Master:
//   Punching/kg + Bending + Fab + PC + Material
// and the ABB part costs sum(qty x sub-part cost).
type ItemRow = {
  sku: string;
  description: string;
  unit_cost: number;
  status: string;
};
const matLabel = (m: string | null) =>
  m === "BO" ? "Bought-out" : m || "Not set";
const n3 = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toFixed(3);
const key = (s: string) => s.trim().toUpperCase();
const money = (v: number) => (v ? formatMoney(v) : "—");

function processLabel(s: ArtukSubpart) {
  if (s.material !== "GI" && s.material !== "CRCA")
    return s.gasket_m != null ? `Gasket ${s.gasket_m} m` : "Fixed price";
  return [
    s.punch === "LASER" ? "Laser" : s.punch === "PUNCHING" ? "Punch" : null,
    s.bending ? "Bend" : null,
    s.fab ? "Fab" : null,
    s.finish === "PC" ? "PC" : s.finish === "PLATING" ? "Plating" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ArtukSubpartsWorkspace({
  initialSubparts,
  initialComponents,
  initialRates,
  items,
  isAdmin,
}: {
  initialSubparts: ArtukSubpart[];
  initialComponents: ArtukPartComponent[];
  initialRates: Rates;
  items: ItemRow[];
  isAdmin: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [subparts, setSubparts] = useState(initialSubparts);
  const [components, setComponents] = useState(initialComponents);
  const rates = initialRates;
  const [tab, setTab] = useState<"parts" | "subparts">("parts");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [editing, setEditing] = useState<ArtukSubpart | null>(null);

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
    for (const c of components) {
      const list = m.get(c.parent_sku) ?? [];
      list.push(c);
      m.set(c.parent_sku, list);
    }
    return Array.from(m.entries())
      .map(([sku, lines]) => {
        lines.sort((a, b) => a.sort_order - b.sort_order);
        let cost = 0;
        let weight = 0;
        for (const l of lines) {
          const s = subById.get(l.subpart_id);
          if (!s) continue;
          cost += l.qty * subpartBreakdown(s, rates).total;
          if (s.material === "GI" || s.material === "CRCA")
            weight += l.qty * Number(s.weight_kg ?? 0);
        }
        return { sku, lines, cost, weight, item: itemBySku.get(key(sku)) };
      })
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [components, subById, rates, itemBySku]);
  const usedIn = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of components)
      m.set(c.subpart_id, (m.get(c.subpart_id) ?? 0) + 1);
    return m;
  }, [components]);

  const terms = filterTerms(q).map((t) => t.toLowerCase());
  const hit = (...fields: (string | null | undefined)[]) =>
    terms.length === 0 ||
    terms.some((t) => fields.some((f) => (f ?? "").toLowerCase().includes(t)));
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
    setTimeout(() => setMsg(null), 5000);
  }

  async function saveSubpart(id: string, patch: Partial<ArtukSubpart>) {
    const { data, error } = await supabase
      .from("artuk_subparts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) return flash(false, error.message);
    setSubparts((list) =>
      list.map((s) => (s.id === id ? (data as ArtukSubpart) : s)),
    );
    flash(true, "Saved. Costs of the ABB parts using it were recalculated.");
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
          <p className="max-w-4xl text-body-sm text-secondary">
            Each ABB enclosure part is built from sub-parts. A fabricated
            sub-part costs <b>Punching/kg + Bending + Fab + PC + Material</b>{" "}
            (the fabrication BOM&apos;s “Total Cost with KG calculation”), using
            the Enclosure Rates Master; gaskets cost length × Gasket/m; other
            bought-out parts keep their own price. An ABB part costs sum(qty ×
            sub-part cost) and is kept in Item Master. Projects with their own
            rates get their own recalculated costs.
          </p>
        </div>
        <button
          onClick={() => setRatesOpen(true)}
          className="btn btn-outline btn-sm"
        >
          Enclosure Rates Master…
        </button>
      </div>
      <p className="text-[12px] text-secondary">
        Rates: CRCA ₹{rates.CRCA}/kg · GI ₹{rates.GI}/kg · Laser ₹{rates.LASER}
        /kg · Punching ₹{rates.PUNCHING}/kg · Bending ₹{rates.BENDING}/kg ·
        Fabrication ₹{rates.FABRICATION}/kg · Powder coating ₹
        {rates.POWDER_COATING}/sq ft · Plating ₹{rates.PLATING}/kg · Gasket ₹
        {rates.GASKET_M}/m
      </p>

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
                <th className="px-2 py-1.5 text-right">Cost</th>
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
                          const next = new Set(s);
                          if (next.has(p.sku)) next.delete(p.sku);
                          else next.add(p.sku);
                          return next;
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
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface-container-lowest">
                        <td colSpan={5} className="px-6 py-2">
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
                <th className="px-2 py-1.5">Matl</th>
                <th className="px-2 py-1.5 text-right">L×W×T (mm)</th>
                <th className="px-2 py-1.5 text-right">Total Wt. (kg)</th>
                <th className="px-2 py-1.5 text-right">PC area (sq ft)</th>
                <th className="px-2 py-1.5">Process</th>
                <th className="px-2 py-1.5 text-right">Punching/kg</th>
                <th className="px-2 py-1.5 text-right">Bending</th>
                <th className="px-2 py-1.5 text-right">Fab</th>
                <th className="px-2 py-1.5 text-right">PC</th>
                <th className="px-2 py-1.5 text-right">Material</th>
                <th className="px-2 py-1.5 text-right">Total</th>
                <th className="px-2 py-1.5 text-center">Used in</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {shownSubs.map((s) => {
                const b = subpartBreakdown(s, rates);
                return (
                  <tr key={s.id} className="border-t border-surface-container">
                    <td className="px-2 py-1 font-bold">{s.code}</td>
                    <td className="px-2 py-1">{s.description}</td>
                    <td className="px-2 py-1">{matLabel(s.material)}</td>
                    <td className="px-2 py-1 text-right">
                      {s.length_mm != null
                        ? `${s.length_mm}×${s.width_mm}×${s.thickness_mm}`
                        : "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {n3(s.weight_kg)}
                      {s.weight_fixed && (
                        <span className="block text-[10px] text-secondary">
                          fixed
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {s.pc_area_sqft != null
                        ? Number(s.pc_area_sqft).toFixed(2)
                        : "—"}
                    </td>
                    <td className="px-2 py-1 text-[11px]">{processLabel(s)}</td>
                    <td className="px-2 py-1 text-right">{money(b.punch)}</td>
                    <td className="px-2 py-1 text-right">{money(b.bending)}</td>
                    <td className="px-2 py-1 text-right">{money(b.fab)}</td>
                    <td className="px-2 py-1 text-right">{money(b.pc)}</td>
                    <td className="px-2 py-1 text-right">
                      {money(b.material)}
                    </td>
                    <td className="px-2 py-1 text-right font-bold">
                      {formatMoney(b.total)}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {usedIn.get(s.id) ?? 0}
                    </td>
                    {isAdmin && (
                      <td className="px-2 py-1">
                        <button
                          onClick={() => setEditing(s)}
                          className="text-[11px] text-primary hover:underline"
                        >
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ratesOpen && (
        <EnclosureRatesDialog
          canEdit={isAdmin}
          onClose={() => setRatesOpen(false)}
          onSaved={() => {
            flash(
              true,
              "Rates saved. All sub-part and ABB part costs were recalculated.",
            );
            router.refresh();
          }}
        />
      )}
      {editing && (
        <SubpartEditor
          subpart={editing}
          rates={rates}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await saveSubpart(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SubpartEditor({
  subpart,
  rates,
  onClose,
  onSave,
}: {
  subpart: ArtukSubpart;
  rates: Rates;
  onClose: () => void;
  onSave: (patch: Partial<ArtukSubpart>) => Promise<void>;
}) {
  const [d, setD] = useState({
    material: subpart.material ?? "",
    length_mm: subpart.length_mm?.toString() ?? "",
    width_mm: subpart.width_mm?.toString() ?? "",
    thickness_mm: subpart.thickness_mm?.toString() ?? "",
    qty_per: String(subpart.qty_per ?? 1),
    weight_fixed: subpart.weight_fixed,
    weight_kg: subpart.weight_kg?.toString() ?? "",
    punch: subpart.punch ?? "",
    bending: subpart.bending,
    fab: subpart.fab,
    finish: subpart.finish ?? "",
    gasket_m: subpart.gasket_m?.toString() ?? "",
    unit_cost: String(subpart.unit_cost ?? 0),
  });
  const [busy, setBusy] = useState(false);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const steel = d.material === "GI" || d.material === "CRCA";
  const L = num(d.length_mm);
  const W = num(d.width_mm);
  const T = num(d.thickness_mm);
  const weight = d.weight_fixed
    ? num(d.weight_kg)
    : L && W && T
      ? ((L * W * T * 7.85) / 1e6) * (num(d.qty_per) ?? 1)
      : null;
  const preview = subpartBreakdown(
    {
      material: (d.material || null) as ArtukSubpart["material"],
      weight_kg: weight,
      pc_area_sqft: L && W ? ((L * W) / 1e6) * 10.76 * 2 : null,
      punch: (d.punch || null) as ArtukSubpart["punch"],
      bending: d.bending,
      fab: d.fab,
      finish: (d.finish || null) as ArtukSubpart["finish"],
      gasket_m: num(d.gasket_m),
      unit_cost: num(d.unit_cost) ?? 0,
    },
    rates,
  );
  const field =
    "w-full rounded border border-surface-container-high bg-surface-container-lowest px-2 py-1";
  return (
    <Modal
      title={`Edit sub-part — ${subpart.code}`}
      onClose={onClose}
      width="max-w-2xl"
    >
      <div className="space-y-3 text-[13px]">
        <div className="grid grid-cols-3 gap-3">
          <label>
            Material
            <select
              value={d.material}
              onChange={(e) => setD({ ...d, material: e.target.value })}
              className={field}
            >
              <option value="GI">GI</option>
              <option value="CRCA">CRCA</option>
              <option value="BO">Bought-out</option>
              <option value="">Not set</option>
            </select>
          </label>
          {steel ? (
            <>
              <label>
                Punching
                <select
                  value={d.punch}
                  onChange={(e) => setD({ ...d, punch: e.target.value })}
                  className={field}
                >
                  <option value="PUNCHING">Punching</option>
                  <option value="LASER">Laser</option>
                  <option value="">None</option>
                </select>
              </label>
              <label>
                Finish
                <select
                  value={d.finish}
                  onChange={(e) => setD({ ...d, finish: e.target.value })}
                  className={field}
                >
                  <option value="PC">Powder coating</option>
                  <option value="PLATING">Plating</option>
                  <option value="">None</option>
                </select>
              </label>
              {(
                ["length_mm", "width_mm", "thickness_mm", "qty_per"] as const
              ).map((k) => (
                <label key={k}>
                  {
                    {
                      length_mm: "Length (mm)",
                      width_mm: "Width (mm)",
                      thickness_mm: "Thickness (mm)",
                      qty_per: "Qty",
                    }[k]
                  }
                  <input
                    value={d[k]}
                    inputMode="decimal"
                    onChange={(e) => setD({ ...d, [k]: e.target.value })}
                    className={field}
                  />
                </label>
              ))}
              <label className="flex items-end gap-2">
                <input
                  type="checkbox"
                  checked={d.bending}
                  onChange={(e) => setD({ ...d, bending: e.target.checked })}
                />{" "}
                Bending
              </label>
              <label className="flex items-end gap-2">
                <input
                  type="checkbox"
                  checked={d.fab}
                  onChange={(e) => setD({ ...d, fab: e.target.checked })}
                />{" "}
                Fabrication
              </label>
              <label className="flex items-end gap-2">
                <input
                  type="checkbox"
                  checked={d.weight_fixed}
                  onChange={(e) =>
                    setD({ ...d, weight_fixed: e.target.checked })
                  }
                />{" "}
                Fixed weight (kg)
              </label>
              {d.weight_fixed && (
                <label>
                  Weight (kg)
                  <input
                    value={d.weight_kg}
                    inputMode="decimal"
                    onChange={(e) => setD({ ...d, weight_kg: e.target.value })}
                    className={field}
                  />
                </label>
              )}
            </>
          ) : (
            <>
              <label>
                Gasket length (m) — blank if not a gasket
                <input
                  value={d.gasket_m}
                  inputMode="decimal"
                  onChange={(e) => setD({ ...d, gasket_m: e.target.value })}
                  className={field}
                />
              </label>
              <label>
                Own cost (INR)
                <input
                  value={d.unit_cost}
                  inputMode="decimal"
                  onChange={(e) => setD({ ...d, unit_cost: e.target.value })}
                  className={field}
                />
              </label>
            </>
          )}
        </div>
        <p className="rounded bg-surface-container-low px-3 py-2 text-[12px]">
          Weight {n3(weight)} kg · Punching {money(preview.punch)} · Bending{" "}
          {money(preview.bending)} · Fab {money(preview.fab)} · PC{" "}
          {money(preview.pc)} · Material {money(preview.material)} →{" "}
          <b>Total {formatMoney(preview.total)}</b>
        </p>
        <div className="flex justify-end gap-2 border-t border-surface-container pt-3">
          <button onClick={onClose} className="btn btn-outline btn-sm">
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onSave({
                material: (d.material || null) as ArtukSubpart["material"],
                length_mm: L,
                width_mm: W,
                thickness_mm: T,
                qty_per: num(d.qty_per) ?? 1,
                weight_fixed: d.weight_fixed,
                weight_kg: d.weight_fixed
                  ? num(d.weight_kg)
                  : subpart.weight_kg,
                punch: (d.punch || null) as ArtukSubpart["punch"],
                bending: d.bending,
                fab: d.fab,
                finish: (d.finish || null) as ArtukSubpart["finish"],
                gasket_m: num(d.gasket_m),
                unit_cost: num(d.unit_cost) ?? 0,
              });
              setBusy(false);
            }}
            className="btn btn-primary btn-sm"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
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
  rates: Rates;
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
            <th className="py-1 pr-2">Matl</th>
            <th className="py-1 pr-2 text-right">Total Wt. (kg)</th>
            <th className="py-1 pr-2">Process</th>
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
            const b = subpartBreakdown(s, rates);
            return (
              <tr key={l.id} className="border-t border-surface-container">
                <td className="py-1 pr-2 font-bold">{s.code}</td>
                <td className="py-1 pr-2">{s.description}</td>
                <td className="py-1 pr-2">{matLabel(s.material)}</td>
                <td className="py-1 pr-2 text-right">{n3(s.weight_kg)}</td>
                <td className="py-1 pr-2 text-[11px]">{processLabel(s)}</td>
                <td
                  className="py-1 pr-2 text-right"
                  title={
                    b.material
                      ? `Punching ${b.punch.toFixed(2)} + Bending ${b.bending.toFixed(2)} + Fab ${b.fab.toFixed(2)} + PC ${b.pc.toFixed(2)} + Material ${b.material.toFixed(2)}`
                      : undefined
                  }
                >
                  {formatMoney(b.total)}
                </td>
                <td className="py-1 pr-2 text-center">
                  {isAdmin ? (
                    <QtyCell value={l.qty} onCommit={(v) => onQty(l.id, v)} />
                  ) : (
                    l.qty
                  )}
                </td>
                <td className="py-1 pr-2 text-right">
                  {formatMoney(b.total * l.qty)}
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
            <td colSpan={7} className="py-1 pr-2 text-right font-bold">
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

function QtyCell({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  return (
    <input
      value={local}
      inputMode="decimal"
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const n = Number(local);
        if (Number.isFinite(n) && n > 0) {
          if (n !== value) onCommit(n);
        } else setLocal(String(value));
      }}
      className="w-16 rounded border border-surface-container-high bg-surface-container-lowest px-1 py-0.5 text-center"
    />
  );
}
