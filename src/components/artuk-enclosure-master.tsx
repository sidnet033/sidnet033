"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";
import { subpartBreakdown, type Rates } from "@/lib/enclosure-rates";
import { filterTerms } from "@/components/multi-filter";
import { Icon } from "@/components/icon";
import { Modal } from "@/components/modal";
import { partImageOf, type PartImage } from "@/lib/artuk-part-images";
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
  [/^(MXM|551)/, "Busbar supports"],
  [/^H23KT/, "MCCB mounting kits"],
  [/^TR/, "Busbar crosspieces"],
  [/^(AA|SA)/, "Lifting & coupling"],
  [/^1BONOB/, "Localisation parts"],
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

// fixed-price sub-part: its cost is its own rate, not a formula
function isFixedPrice(s: ArtukSubpart) {
  const steel =
    (s.material === "GI" || s.material === "CRCA") &&
    Number(s.weight_kg ?? 0) > 0;
  return !steel && s.gasket_m == null;
}

const BUCKET = "artuk-part-images";

export function ArtukEnclosureMaster({
  subparts: initialSubparts,
  components: initialComponents,
  rates,
  items,
  canEdit = false,
}: {
  subparts: ArtukSubpart[];
  components: ArtukPartComponent[];
  rates: Rates;
  items: ItemRow[];
  canEdit?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [subparts, setSubparts] = useState(initialSubparts);
  const [components, setComponents] = useState(initialComponents);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  };

  // pictures uploaded by admins (Supabase Storage); built-in ones otherwise
  const [uploaded, setUploaded] = useState<
    Map<string, { path: string; caption: string | null }>
  >(new Map());
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    supabase
      .from("artuk_part_images")
      .select("sku, path, caption")
      .then(({ data }) =>
        setUploaded(
          new Map(
            (
              (data ?? []) as {
                sku: string;
                path: string;
                caption: string | null;
              }[]
            ).map((r) => [r.sku, { path: r.path, caption: r.caption }]),
          ),
        ),
      );
  }, [supabase]);
  const imageFor = (
    sku: string,
    description: string | null | undefined,
  ): PartImage | null => {
    const u = uploaded.get(sku);
    if (u)
      return {
        src: supabase.storage.from(BUCKET).getPublicUrl(u.path).data.publicUrl,
        caption: u.caption ?? `${sku}${description ? ` — ${description}` : ""}`,
      };
    return partImageOf(sku, description);
  };
  async function uploadPicture(sku: string, file: File) {
    if (!file.type.startsWith("image/"))
      return flash(false, "Pick an image file (PNG, JPG, WEBP or GIF).");
    if (file.size > 5 * 1024 * 1024)
      return flash(false, "The picture must be 5 MB or smaller.");
    setUploading(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${sku.replace(/[^A-Za-z0-9_-]+/g, "_")}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type });
    if (upErr) {
      setUploading(false);
      return flash(false, upErr.message);
    }
    const { error } = await supabase
      .from("artuk_part_images")
      .upsert({ sku, path, updated_at: new Date().toISOString() });
    if (error) {
      await supabase.storage.from(BUCKET).remove([path]);
      setUploading(false);
      return flash(false, error.message);
    }
    const old = uploaded.get(sku)?.path;
    if (old) await supabase.storage.from(BUCKET).remove([old]);
    setUploaded((m) => new Map(m).set(sku, { path, caption: null }));
    setUploading(false);
    flash(true, `Picture saved for ${sku}.`);
  }
  async function removePicture(sku: string) {
    const u = uploaded.get(sku);
    if (!u) return;
    if (!window.confirm(`Remove the uploaded picture of ${sku}?`)) return;
    const { error } = await supabase
      .from("artuk_part_images")
      .delete()
      .eq("sku", sku);
    if (error) return flash(false, error.message);
    await supabase.storage.from(BUCKET).remove([u.path]);
    setUploaded((m) => {
      const n = new Map(m);
      n.delete(sku);
      return n;
    });
    flash(true, `Uploaded picture of ${sku} removed.`);
  }
  async function saveQty(lineId: string, qty: number) {
    const { error } = await supabase
      .from("artuk_part_components")
      .update({ qty })
      .eq("id", lineId);
    if (error) return flash(false, error.message);
    setComponents((list) =>
      list.map((c) => (c.id === lineId ? { ...c, qty } : c)),
    );
    flash(true, "Qty saved — the part's cost was recalculated.");
  }
  async function saveRate(subId: string, rate: number) {
    const { error } = await supabase
      .from("artuk_subparts")
      .update({ unit_cost: rate, updated_at: new Date().toISOString() })
      .eq("id", subId);
    if (error) return flash(false, error.message);
    setSubparts((list) =>
      list.map((x) => (x.id === subId ? { ...x, unit_cost: rate } : x)),
    );
    flash(
      true,
      "Rate saved — every part using this sub-part was recalculated.",
    );
  }
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
    // every ArTuK part: those with a sub-part breakdown and the rest of the
    // ArTuK parts in Item Master
    const all = new Map<string, ArtukPartComponent[]>();
    for (const [sku, lines] of m) all.set(sku, lines);
    for (const i of items)
      if (![...all.keys()].some((k) => key(k) === key(i.sku)))
        all.set(i.sku.trim(), []);
    return Array.from(all.entries())
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
        const item = itemBySku.get(key(sku));
        const total = rows.length
          ? rows.reduce((t, r) => t + r.unit * r.line.qty, 0)
          : Number(item?.unit_cost ?? 0);
        return {
          sku,
          rows,
          total,
          family: familyOf(sku),
          description: itemBySku.get(key(sku))?.description ?? null,
        };
      })
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [components, subById, rates, itemBySku, items]);

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
  const [picture, setPicture] = useState<PartImage | null>(null);
  const terms = filterTerms(q).map((t) => t.toLowerCase());
  const shown = parts.filter(
    (p) =>
      (!family || p.family === family) &&
      (terms.length === 0 ||
        terms.some(
          (t) =>
            p.sku.toLowerCase().includes(t) ||
            (p.description ?? "").toLowerCase().includes(t),
        )),
  );
  const firstInList =
    families.flatMap((f) => shown.filter((p) => p.family === f))[0] ?? null;
  const part = parts.find((p) => p.sku === selected) ?? firstInList;
  // parts that have their own sub-part breakdown
  const withBreakdown = new Set(
    parts.filter((p) => p.rows.length > 0).map((p) => key(p.sku)),
  );

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
        <div className="flex h-[calc(100vh-12rem)] min-h-[24rem] flex-col rounded-lg border border-surface-container-high">
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
                      <div
                        key={p.sku}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelected(p.sku)}
                        onKeyDown={(e) =>
                          (e.key === "Enter" || e.key === " ") &&
                          setSelected(p.sku)
                        }
                        className={`block w-full cursor-pointer border-b border-surface-container px-3 py-2 text-left ${
                          p.sku === part?.sku
                            ? "bg-primary/10"
                            : "hover:bg-surface-container-low"
                        }`}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={`text-[13px] ${p.rows.length ? "font-bold" : "font-normal"} ${p.sku === part?.sku ? "text-primary" : "text-on-surface"}`}
                          >
                            {p.sku}
                            {(() => {
                              const img = imageFor(p.sku, p.description);
                              return img ? (
                                <button
                                  type="button"
                                  title="View picture of this part"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPicture(img);
                                  }}
                                  className="ml-1.5 inline-flex align-middle text-primary hover:text-primary/70"
                                >
                                  <Icon name="image" size={16} />
                                </button>
                              ) : null;
                            })()}
                          </span>
                          <span className="text-[12px] text-secondary">
                            {formatMoney(p.total)}
                          </span>
                        </span>
                        <span className="block truncate text-[11px] text-secondary">
                          {p.description ?? "Not in Item Master"}
                        </span>
                      </div>
                    ))}
                </div>
              ))}
          </div>
        </div>

        {/* sub-parts of the selected part */}
        <div className="h-[calc(100vh-12rem)] min-h-[24rem] min-w-0 overflow-y-auto">
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
                <div className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const img = imageFor(part.sku, part.description);
                    return img ? (
                      <button
                        type="button"
                        onClick={() => setPicture(img)}
                        className="btn btn-outline btn-sm"
                      >
                        <Icon name="image" size={16} /> Picture
                      </button>
                    ) : null;
                  })()}
                  {canEdit && (
                    <>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) uploadPicture(part.sku, f);
                        }}
                      />
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => fileRef.current?.click()}
                        className="btn btn-outline btn-sm"
                        title="Admins: upload a picture of this part (PNG, JPG, WEBP or GIF, up to 5 MB)"
                      >
                        <Icon name="upload" size={16} />
                        {uploading
                          ? "Uploading…"
                          : uploaded.has(part.sku)
                            ? "Replace picture"
                            : "Upload picture"}
                      </button>
                      {uploaded.has(part.sku) && (
                        <button
                          type="button"
                          onClick={() => removePicture(part.sku)}
                          className="btn btn-outline btn-sm text-error"
                        >
                          Remove upload
                        </button>
                      )}
                    </>
                  )}
                </div>
                <p className="text-[15px] font-bold">
                  Unit cost {formatMoney(part.total)}
                  <span className="ml-2 text-[12px] font-normal text-secondary">
                    {part.rows.length} sub-part
                    {part.rows.length === 1 ? "" : "s"}
                  </span>
                </p>
              </div>
              {msg && (
                <p
                  className={`text-[12px] ${msg.ok ? "text-emerald-700" : "text-error"}`}
                >
                  {msg.text}
                </p>
              )}
              {canEdit && part.rows.length > 0 && (
                <p className="text-[11px] text-secondary">
                  Edit a qty, or the rate of a fixed-price sub-part, and press
                  Tab / click away to save. Formula-based costs follow the
                  weights and the Enclosure Rates Master.
                </p>
              )}
              {part.rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-surface-container-high bg-surface-container-low px-4 py-6 text-center text-body-sm text-secondary">
                  No sub-part breakdown for this part yet — it&apos;s priced at
                  its Item Master cost.
                </p>
              ) : (
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
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {withBreakdown.has(key(sub.code)) &&
                            key(sub.code) !== key(part.sku) ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setSelected(
                                    parts.find(
                                      (p) => key(p.sku) === key(sub.code),
                                    )!.sku,
                                  )
                                }
                                title="Has its own sub-parts — click to open"
                                className="font-bold text-primary hover:underline"
                              >
                                {sub.code} ›
                              </button>
                            ) : (
                              sub.code
                            )}
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
                            {canEdit && isFixedPrice(sub) ? (
                              <NumberInput
                                key={`r-${sub.id}-${sub.unit_cost}`}
                                value={Number(sub.unit_cost)}
                                min={0}
                                prefix="₹"
                                title="Fixed price — edit the rate"
                                onCommit={(v) => saveRate(sub.id, v)}
                              />
                            ) : (
                              formatMoney(unit)
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {canEdit ? (
                              <NumberInput
                                key={`q-${line.id}-${line.qty}`}
                                value={Number(line.qty)}
                                min={0.001}
                                title="Qty of this sub-part in the part"
                                onCommit={(v) => saveQty(line.id, v)}
                              />
                            ) : (
                              line.qty
                            )}
                          </td>
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
              )}
            </div>
          )}
        </div>
      </div>
      {picture && (
        <Modal
          title={picture.caption}
          onClose={() => setPicture(null)}
          width="max-w-4xl"
        >
          <div className="rounded-lg bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={picture.src}
              alt={picture.caption}
              className="mx-auto max-h-[75vh] w-auto object-contain"
            />
          </div>
          {picture.typical && (
            <p className="mt-2 text-[12px] text-secondary">
              Typical view — the kit for this ACB frame / width looks the same
              but its dimensions differ.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

function NumberInput({
  value,
  min,
  prefix,
  title,
  onCommit,
}: {
  value: number;
  min: number;
  prefix?: string;
  title?: string;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  return (
    <span className="inline-flex items-center gap-0.5">
      {prefix && <span className="text-secondary">{prefix}</span>}
      <input
        value={local}
        inputMode="decimal"
        title={title}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onBlur={() => {
          const n = Number(local);
          if (Number.isFinite(n) && n >= min) {
            if (n !== value) onCommit(n);
          } else setLocal(String(value));
        }}
        className="w-20 rounded border border-surface-container-high bg-surface-container-lowest px-1.5 py-0.5 text-right"
      />
    </span>
  );
}
