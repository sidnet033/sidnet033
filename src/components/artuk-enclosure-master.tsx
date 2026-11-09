"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { subpartBreakdown, type Rates } from "@/lib/enclosure-rates";
import { filterTerms } from "@/components/multi-filter";
import type { ArtukPartComponent, ArtukSubpart } from "@/types/database";

// ArTuK Enclosure Master: pick an ABB enclosure part on the left, see what
// it's made of on the right -- each sub-part with its description, material,
// how its cost is worked out, unit cost, qty in the part and amount.
type ItemRow = {
  sku: string;
  description: string;
  unit_cost: number;
  status: string;
};
const key = (s: string) => s.trim().toUpperCase();
const n = (v: number, d = 2) =>
  Number(v).toLocaleString("en-IN", { maximumFractionDigits: d });

// ABB part family, from the code's prefix (ABB's catalogue groups)
const FAMILIES: [RegExp, string][] = [
  [/^SK\d{2}00-/, "Uprights"],
  [/^SK\d{2}02-/, "Functional frames"],
  [/^(SK|VC30)\d/, "Top/base sets"],
  [/^PV/, "Glass doors"],
  [/^PO/, "Metal doors"],
  [/^RF/, "Rear panels / doors"],
  [/^LF/, "Side panels"],
  [/^KN/, "ACB kits"],
  [/^FH_E/, "ACB segregation kits"],
  [/^FH/, "MCCB segregation kits"],
  [/^PC/, "Blind panels"],
  [/^PF/, "Blind back plates"],
  [/^SH/, "Busbar segregation shelves"],
  [/^SV/, "Busbar segregation"],
  [/^TV/, "Busbar crosspieces"],
  [/^VC/, "Cable containers"],
  [/^(AD|APR)/, "Fixings & hinges"],
  [/^(85\d{4}|VTBCE)/, "Hardware & logo strips"],
];
export function familyOf(code: string): string {
  return (
    FAMILIES.find(([re]) => re.test(code.trim().toUpperCase()))?.[1] ?? "Other"
  );
}

function materialLabel(s: ArtukSubpart) {
  if (s.material === "GI") return "GI (steel)";
  if (s.material === "CRCA") return "CRCA (steel)";
  if (s.gasket_m != null) return "Gasket";
  if (s.material === "BO") return "Bought-out";
  return "Other";
}

// how the sub-part's unit cost is worked out, in words, with the numbers
function methodOf(s: ArtukSubpart, r: Rates): string[] {
  const w = Number(s.weight_kg ?? 0);
  if ((s.material === "GI" || s.material === "CRCA") && w > 0) {
    const perKg: string[] = [];
    if (s.punch)
      perKg.push(
        `${s.punch === "LASER" ? "Laser" : "Punching"} ₹${r[s.punch]}`,
      );
    if (s.bending) perKg.push(`Bending ₹${r.BENDING}`);
    if (s.fab) perKg.push(`Fabrication ₹${r.FABRICATION}`);
    if (s.finish === "PLATING") perKg.push(`Plating ₹${r.PLATING}`);
    perKg.push(`${s.material} ₹${r[s.material]}`);
    const out = [
      `By weight: ${n(w, 3)} kg${s.weight_fixed ? " (fixed)" : ` (${n(Number(s.length_mm))}×${n(Number(s.width_mm))}×${n(Number(s.thickness_mm))} mm × 7.85)`} × (${perKg.join(" + ")})/kg`,
    ];
    if (s.finish === "PC")
      out.push(
        `+ powder coating: ${n(Number(s.pc_area_sqft ?? 0))} sq ft × ₹${r.POWDER_COATING}/sq ft`,
      );
    return out;
  }
  if (s.gasket_m != null)
    return [`By length: ${n(Number(s.gasket_m), 3)} m × ₹${r.GASKET_M}/m`];
  if (s.material === "BO") return ["Fixed price (bought-out)"];
  return ["Fixed price (no weight on file)"];
}

export function ArtukEnclosureMaster({
  subparts,
  components,
  rates,
  items,
}: {
  subparts: ArtukSubpart[];
  components: ArtukPartComponent[];
  rates: Rates;
  items: ItemRow[];
}) {
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
        const rows = lines
          .map((l) => {
            const s = subById.get(l.subpart_id);
            return s
              ? { line: l, sub: s, unit: subpartBreakdown(s, rates).total }
              : null;
          })
          .filter(
            (
              x,
            ): x is {
              line: ArtukPartComponent;
              sub: ArtukSubpart;
              unit: number;
            } => !!x,
          );
        const total = rows.reduce((t, r) => t + r.unit * r.line.qty, 0);
        return {
          sku,
          rows,
          total,
          family: familyOf(sku),
          description: itemBySku.get(key(sku))?.description ?? null,
        };
      })
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [components, subById, rates, itemBySku]);

  const [q, setQ] = useState("");
  const [family, setFamily] = useState("");
  const families = useMemo(
    () =>
      FAMILIES.map(([, f]) => f)
        .filter((f, i, a) => a.indexOf(f) === i)
        .concat("Other")
        .filter((f) => parts.some((p) => p.family === f)),
    [parts],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const terms = filterTerms(q).map((t) => t.toLowerCase());
  const shown = parts.filter(
    (p) =>
      ((!family || p.family === family) && terms.length === 0) ||
      terms.some(
        (t) =>
          p.sku.toLowerCase().includes(t) ||
          (p.description ?? "").toLowerCase().includes(t),
      ),
  );
  const firstInList =
    families.flatMap((f) => shown.filter((p) => p.family === f))[0] ?? null;
  const part = parts.find((p) => p.sku === selected) ?? firstInList;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-sm font-bold text-on-surface">
            ArTuK Enclosure Master
          </h1>
          <p className="text-body-sm text-secondary">
            Each ABB enclosure part and the sub-parts it&apos;s made of. Costs
            at the app&apos;s Enclosure Rates Master (CRCA ₹{rates.CRCA}, GI ₹
            {rates.GI}/kg); a project with its own rates is costed at those.
          </p>
        </div>
        <Link
          href="/artuk-subparts"
          className="text-[12px] text-primary hover:underline"
        >
          Edit sub-parts &amp; rates ↗
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* parts */}
        <div className="flex max-h-[78vh] flex-col rounded-lg border border-surface-container-high">
          <div className="border-b border-surface-container-high p-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search part — use | for several"
              className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-2 py-1.5 text-body-sm"
            />
            <select
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              className="mt-1.5 w-full rounded border border-surface-container-high bg-surface-container-lowest px-2 py-1 text-body-sm"
            >
              <option value="">All families</option>
              {families.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-secondary">
              {shown.length} of {parts.length} parts
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {families
              .filter((f) => shown.some((p) => p.family === f))
              .map((f) => (
                <div key={f}>
                  <div className="sticky top-0 z-10 border-b border-surface-container-high bg-surface-container-low px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    {f}{" "}
                    <span className="font-normal normal-case text-secondary">
                      ({shown.filter((p) => p.family === f).length})
                    </span>
                  </div>
                  {shown
                    .filter((p) => p.family === f)
                    .map((p) => (
                      <button
                        key={p.sku}
                        type="button"
                        onClick={() => setSelected(p.sku)}
                        className={`block w-full border-b border-surface-container px-3 py-2 text-left ${
                          p.sku === part?.sku
                            ? "bg-primary/10"
                            : "hover:bg-surface-container-low"
                        }`}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={`text-[13px] font-bold ${p.sku === part?.sku ? "text-primary" : "text-on-surface"}`}
                          >
                            {p.sku}
                          </span>
                          <span className="text-[12px] text-secondary">
                            {formatMoney(p.total)}
                          </span>
                        </span>
                        <span className="block truncate text-[11px] text-secondary">
                          {p.description ?? "Not in Item Master"}
                        </span>
                      </button>
                    ))}
                </div>
              ))}
          </div>
        </div>

        {/* sub-parts of the selected part */}
        <div className="min-w-0">
          {!part ? (
            <p className="text-secondary">Pick a part on the left.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-[17px] font-bold text-primary">
                    {part.sku}
                    <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 align-middle text-[12px] font-medium">
                      {part.family}
                    </span>
                  </h2>
                  <p className="text-body-sm text-on-surface-variant">
                    {part.description ?? "Not in Item Master"}
                  </p>
                </div>
                <p className="text-[15px] font-bold">
                  Unit cost {formatMoney(part.total)}
                  <span className="ml-2 text-[12px] font-normal text-secondary">
                    {part.rows.length} sub-part
                    {part.rows.length === 1 ? "" : "s"}
                  </span>
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-surface-container-high">
                <table className="w-full border-collapse text-[12px]">
                  <thead className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-secondary">
                    <tr>
                      <th className="px-2 py-1.5">Sub-part</th>
                      <th className="px-2 py-1.5">Description</th>
                      <th className="px-2 py-1.5">Family</th>
                      <th className="px-2 py-1.5">Material</th>
                      <th className="px-2 py-1.5">Cost calculation</th>
                      <th className="px-2 py-1.5 text-right">Unit cost</th>
                      <th className="px-2 py-1.5 text-center">Qty in part</th>
                      <th className="px-2 py-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {part.rows.map(({ line, sub, unit }) => (
                      <tr
                        key={line.id}
                        className="border-t border-surface-container align-top"
                      >
                        <td className="px-2 py-1.5 font-bold whitespace-nowrap">
                          {sub.code}
                        </td>
                        <td className="px-2 py-1.5">{sub.description}</td>
                        <td className="px-2 py-1.5">
                          {sub.family ?? (
                            <span className="text-secondary">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {materialLabel(sub)}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-on-surface-variant">
                          {methodOf(sub, rates).map((m) => (
                            <span key={m} className="block">
                              {m}
                            </span>
                          ))}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          {formatMoney(unit)}
                        </td>
                        <td className="px-2 py-1.5 text-center">{line.qty}</td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          {formatMoney(unit * line.qty)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-primary">
                      <td
                        colSpan={7}
                        className="px-2 py-1.5 text-right font-bold"
                      >
                        {part.sku} total
                      </td>
                      <td className="px-2 py-1.5 text-right font-bold text-primary whitespace-nowrap">
                        {formatMoney(part.total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
