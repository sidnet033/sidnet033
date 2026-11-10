"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Modal } from "@/components/modal";
import { createClient } from "@/lib/supabase/client";
import { effectiveNetRate } from "@/lib/feeder-cost";
import {
  ARTUK_BAY_CONFIGS,
  ARTUK_HEIGHT_MM,
  bayImage,
  sheetImage,
  type ArtukBayConfig,
} from "@/lib/artuk-bay-configs";
import {
  loadBayTemplates,
  withArc,
  type ArtukBayTemplate,
  type ArtukTemplateLine,
} from "@/lib/artuk-bay-templates";

// Pick a standard ABB ArTu-K vertical for a GA bay. Left: every config with
// its key specs; right: the selected config's ABB sheet data -- the spec box
// (width, depth, height, IP, form, overall dimension, ACB type) and the GA
// front + side view -- with a link to the full sheet and its parts list.
// Without onApply (opened from the Enclosure Rates Master) it is a read-only
// catalogue; admins can add / remove parts in a bay's parts list there.
export function ArtukBayConfigDialog({
  bayName,
  currentId = null,
  misfitsFor,
  onApply,
  onClose,
}: {
  bayName?: string;
  currentId?: string | null;
  misfitsFor?: (c: ArtukBayConfig) => string[];
  onApply?: (c: ArtukBayConfig) => void;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const browse = !onApply;
  const [selectedId, setSelectedId] = useState(
    currentId ?? ARTUK_BAY_CONFIGS[0].id,
  );
  const sel =
    ARTUK_BAY_CONFIGS.find((c) => c.id === selectedId) ?? ARTUK_BAY_CONFIGS[0];
  const selMisfits = misfitsFor ? misfitsFor(sel) : [];
  const [partsTab, setPartsTab] = useState<"parts" | "drawing">("parts");
  const [templates, setTemplates] = useState<ArtukBayTemplate[] | null>(null);
  const [prices, setPrices] = useState<Map<string, ItemPrice>>(new Map());
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const t = await loadBayTemplates(supabase);
      const p = await loadPrices(
        supabase,
        t.flatMap((x) => x.lines.map((l) => l.code)),
      );
      setTemplates(t);
      setPrices(p);
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Could not load the parts lists.",
      );
    }
  }, [supabase]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    if (browse)
      supabase.rpc("is_admin").then(({ data }) => setIsAdmin(data === true));
  }, [reload, supabase, browse]);

  return (
    <Modal
      title={browse ? "ArTu-K bay configs" : `ArTu-K bay config — ${bayName}`}
      onClose={onClose}
      width="max-w-7xl"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* list */}
        <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
          {ARTUK_BAY_CONFIGS.map((c) => {
            const misfits = misfitsFor ? misfitsFor(c) : [];
            const active = c.id === sel.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`flex w-full gap-2.5 rounded-lg border p-2 text-left transition-colors ${
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-surface-container-high hover:bg-surface-container-low"
                }`}
              >
                {c.page > 0 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={bayImage(c)}
                    alt=""
                    loading="lazy"
                    className="h-20 w-20 shrink-0 rounded border border-surface-container-high bg-white object-contain"
                  />
                ) : (
                  <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded border border-dashed border-surface-container-high bg-surface-container-low p-1 text-center text-[10px] text-secondary">
                    Workbook parts list
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold leading-tight text-on-surface">
                    {c.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-secondary">
                    {widthText(c)} × {depthText(c)} × {ARTUK_HEIGHT_MM} mm · IP
                    {c.ip} · Form {c.form}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {c.id === currentId && <Pill tone="blue">Current</Pill>}
                    {!browse &&
                      (misfits.length === 0 ? (
                        <Pill tone="green">Suits this bay</Pill>
                      ) : (
                        <Pill tone="amber">May not suit</Pill>
                      ))}
                    {c.partner && (
                      <Pill tone="grey">+ {c.partner.widthMm}mm bay</Pill>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* detail */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-[15px] font-bold text-on-surface">
                {sel.label}
              </h4>
              <p className="text-[11px] text-secondary">
                {sel.page > 0
                  ? `ABB · ArTu-K Assembly Guideline & Standard Compartment Sizes (ELSP/ARTUK/ENGG/WEL KIT, R3) · page ${sel.page} of 17`
                  : "ArTuK fabrication BOM workbook (no ABB guideline drawing)"}
              </p>
            </div>
            <table className="border-collapse text-[12px]">
              <tbody>
                <SpecRow k="Panel Width" v={`${widthText(sel)}mm`} />
                <SpecRow k="Panel Depth" v={`${depthText(sel)}mm`} />
                <SpecRow k="Panel Height" v={`${ARTUK_HEIGHT_MM}mm`} />
                <SpecRow k="Ingress Protection" v={`IP${sel.ip}`} />
                <SpecRow k="Form of Separation" v={`Form ${sel.form}`} />
                <SpecRow
                  k="Overall Dimension"
                  v={`${overallWidth(sel)}×${sel.depthMm}×${ARTUK_HEIGHT_MM} mm`}
                />
                <SpecRow
                  k={sel.kind === "acb" ? "ACB Type" : "Breaker Type"}
                  v={
                    sel.kind === "acb"
                      ? `Emax 2_${sel.frame}`
                      : sel.functions.length === 0
                        ? "None (riser)"
                        : "MCCB"
                  }
                />
                <SpecRow
                  k="Access"
                  v={sel.access === "front" ? "Front access" : "Rear access"}
                />
              </tbody>
            </table>
          </div>

          {sel.note && (
            <p className="text-[12px] text-on-surface-variant">{sel.note}</p>
          )}
          {sel.partner && (
            <p className="text-[12px] text-on-surface-variant">
              Two bays: this bay becomes {sel.widthMm}mm and a{" "}
              {sel.partner.widthMm}mm{" "}
              {sel.partner.bayType === "cable_alley" ? "cable chamber" : "bay"}{" "}
              (&quot;{sel.partner.name}&quot;) is added right next to it.
            </p>
          )}

          {selMisfits.length > 0 && (
            <div className="rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-900">
              <b>May not suit this bay</b> — you can still apply it:
              <ul className="mt-0.5 list-disc pl-5">
                {selMisfits.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-container-low px-3 py-2">
            {sel.page > 0 ? (
              <a
                href={sheetImage(sel)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-primary hover:underline"
              >
                Open the full ABB sheet ↗
              </a>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button onClick={onClose} className="btn btn-outline btn-sm">
                {browse ? "Close" : "Cancel"}
              </button>
              {onApply && (
                <button
                  onClick={() => onApply(sel)}
                  className="btn btn-primary btn-sm"
                >
                  {sel.id === currentId
                    ? "Re-apply this config"
                    : "Apply to this bay"}
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPartsTab("parts")}
              className={`btn btn-sm ${partsTab === "parts" ? "btn-primary" : "btn-outline"}`}
            >
              Parts list
            </button>
            {sel.page > 0 && (
              <button
                type="button"
                onClick={() => setPartsTab("drawing")}
                className={`btn btn-sm ${partsTab === "drawing" ? "btn-primary" : "btn-outline"}`}
              >
                Drawing
              </button>
            )}
          </div>
          {partsTab === "drawing" && sel.page > 0 ? (
            <div className="rounded-lg border border-surface-container-high bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bayImage(sel)}
                alt={`${sel.label} — front and side view`}
                className="mx-auto max-h-[42vh] w-auto object-contain"
              />
            </div>
          ) : (
            <PartsList
              keys={sel.workbookKeys ?? []}
              templates={templates}
              prices={prices}
              loadError={loadError}
              canEdit={browse && isAdmin}
              supabase={supabase}
              onChanged={reload}
            />
          )}

          {!browse && (
            <p className="text-[11px] text-secondary">
              Applying sets the bay&apos;s width and depth (the whole panel
              takes the deepest bay&apos;s depth), adds a partner bay where the
              config has one, and redraws the busbars, busbar supports and
              enclosure parts from the new layout. Feeders stay where they are.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function widthText(c: ArtukBayConfig) {
  return c.partner ? `${c.widthMm}+${c.partner.widthMm}` : String(c.widthMm);
}
function depthText(c: ArtukBayConfig) {
  return c.depthNote ?? String(c.depthMm);
}
// ABB's overall width adds 28mm for the end side panels
function overallWidth(c: ArtukBayConfig) {
  return c.widthMm + (c.partner?.widthMm ?? 0) + 28;
}

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td className="border border-surface-container-high bg-surface-container-low px-2 py-0.5 font-bold">
        {k}
      </td>
      <td className="border border-surface-container-high px-2 py-0.5 tabular-nums">
        {v}
      </td>
    </tr>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "blue" | "green" | "amber" | "grey";
  children: React.ReactNode;
}) {
  const cls = {
    blue: "bg-primary/10 text-primary",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    grey: "bg-surface-container-high text-on-surface-variant",
  }[tone];
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>
      {children}
    </span>
  );
}

const SECTIONS: { key: ArtukTemplateLine["section"]; title: string }[] = [
  { key: "vertical", title: "Per vertical" },
  { key: "panel", title: "Once per entire panel" },
  { key: "arc_vertical", title: "Internal arc — per vertical" },
  { key: "arc_panel", title: "Internal arc — once per panel" },
];

type ItemPrice = { description: string; rate: number };

// App-level price of each part: Item Master net rate (ABB parts with
// sub-parts carry their cost at the app's Enclosure Rates Master there).
// Project rate overrides are deliberately not used here.
async function loadPrices(
  supabase: SupabaseClient,
  codes: string[],
): Promise<Map<string, ItemPrice>> {
  const uniq = [...new Set(codes)];
  const out = new Map<string, ItemPrice>();
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await supabase
      .from("item_master")
      .select("sku, description, unit_cost, list_price, discount_pct")
      .in("sku", uniq.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as {
      sku: string;
      description: string;
      unit_cost: number;
      list_price: number | null;
      discount_pct: number | null;
    }[])
      out.set(r.sku, {
        description: r.description,
        rate: effectiveNetRate({
          unit_cost: Number(r.unit_cost),
          list_price: r.list_price,
          discount_pct: r.discount_pct,
        }),
      });
  }
  return out;
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// The vertical's parts list (seeded from the fabrication-BOM workbook) --
// what the enclosure costing uses for a bay of this type -- priced at the
// app's rates. Admins can add and remove parts.
function PartsList({
  keys,
  templates: all,
  prices,
  loadError,
  canEdit,
  supabase,
  onChanged,
}: {
  keys: string[];
  templates: ArtukBayTemplate[] | null;
  prices: Map<string, ItemPrice>;
  loadError: string | null;
  canEdit: boolean;
  supabase: SupabaseClient;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (loadError) return <p className="text-[12px] text-error">{loadError}</p>;
  if (!all)
    return <p className="text-[12px] text-secondary">Loading parts list…</p>;
  const templates = keys
    .map((k) => all.find((t) => t.key === k))
    .filter((t): t is ArtukBayTemplate => !!t);
  if (templates.length === 0)
    return (
      <p className="rounded-lg bg-surface-container-low px-3 py-2 text-[12px] text-secondary">
        No workbook parts list for this vertical — its enclosure parts come from
        the ABB rules.
      </p>
    );

  const priceOf = (l: ArtukTemplateLine) => {
    const p = prices.get(l.code);
    if (p && p.rate > 0) return { rate: p.rate, src: "im" as const };
    if (l.unitCost != null && l.unitCost > 0)
      return { rate: l.unitCost, src: "wb" as const };
    return { rate: 0, src: "none" as const };
  };
  const sum = (lines: ArtukTemplateLine[]) =>
    lines.reduce((s, l) => s + priceOf(l).rate * l.qty, 0);

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setError(null);
    const { error: e } = await fn();
    if (e)
      setError(
        (e as { message?: string }).message ?? "Could not save the change.",
      );
    else await onChanged();
    setBusy(false);
  }
  const remove = (t: ArtukBayTemplate, l: ArtukTemplateLine) => {
    if (!l.id) return;
    if (!window.confirm(`Remove ${l.code} from "${t.title}"?`)) return;
    run(() =>
      supabase.from("artuk_bay_template_lines").delete().eq("id", l.id!),
    );
  };
  const add = (
    t: ArtukBayTemplate,
    section: ArtukTemplateLine["section"],
    code: string,
    qty: number,
    replaces: string | null,
  ) =>
    run(async () => {
      const { data: item } = await supabase
        .from("item_master")
        .select("description")
        .eq("sku", code)
        .maybeSingle();
      return supabase.from("artuk_bay_template_lines").insert({
        template_key: t.key,
        section,
        code,
        description:
          (item as { description: string } | null)?.description ?? "",
        qty,
        replaces,
        sort_order: t.lines.length,
      });
    });

  return (
    <div className="max-h-[48vh] space-y-3 overflow-y-auto rounded-lg border border-surface-container-high p-2">
      {templates.map((t) => {
        const std =
          sum(withArc(t.lines, "vertical", false)) +
          sum(withArc(t.lines, "panel", false));
        const arc =
          sum(withArc(t.lines, "vertical", true)) +
          sum(withArc(t.lines, "panel", true));
        const hasArc = t.lines.some((l) => l.section.startsWith("arc_"));
        return (
          <div key={t.key}>
            {templates.length > 1 && (
              <p className="mb-1 text-[12px] font-bold text-on-surface">
                {t.title}
              </p>
            )}
            <div className="mb-2 flex flex-wrap gap-2">
              <TotalChip
                label="Bay cost"
                sub="vertical + once-per-panel parts"
                value={rupees(std)}
              />
              {hasArc && (
                <TotalChip
                  label="With internal arc"
                  sub="arc parts swapped in"
                  value={rupees(arc)}
                />
              )}
            </div>
            {SECTIONS.map(({ key, title }) => {
              const lines = t.lines.filter((l) => l.section === key);
              if (lines.length === 0 && !canEdit) return null;
              return (
                <table
                  key={key}
                  className="mb-2 w-full border-collapse text-[12px]"
                >
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-secondary">
                      <th className="py-1 pr-2" colSpan={2}>
                        {title}
                      </th>
                      <th className="py-1 pr-2 text-center">Qty</th>
                      <th className="py-1 pr-2 text-right">Unit cost</th>
                      <th className="py-1 text-right">Amount</th>
                      {canEdit && <th className="w-6" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const p = priceOf(l);
                      return (
                        <tr
                          key={l.id ?? `${l.code}-${i}`}
                          className="border-t border-surface-container"
                        >
                          <td className="py-0.5 pr-2 font-bold whitespace-nowrap">
                            {l.code}
                          </td>
                          <td className="py-0.5 pr-2">
                            {l.description ||
                              prices.get(l.code)?.description ||
                              ""}
                            {l.replaces && (
                              <span className="block text-[11px] text-secondary">
                                replaces {l.replaces}
                              </span>
                            )}
                          </td>
                          <td className="py-0.5 pr-2 text-center">{l.qty}</td>
                          <td className="py-0.5 pr-2 text-right whitespace-nowrap">
                            {p.rate > 0 ? rupees(p.rate) : "—"}
                            {p.src === "wb" && (
                              <span
                                className="ml-1 text-[10px] text-amber-700"
                                title="Not priced in Item Master — workbook price"
                              >
                                wb
                              </span>
                            )}
                          </td>
                          <td className="py-0.5 text-right">
                            {p.rate > 0 ? rupees(p.rate * l.qty) : "—"}
                          </td>
                          {canEdit && (
                            <td className="py-0.5 text-right">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => remove(t, l)}
                                title="Remove from this bay"
                                className="px-1 text-error hover:font-bold disabled:opacity-40"
                              >
                                ×
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {lines.length > 0 && (
                      <tr className="border-t border-surface-container-high font-bold">
                        <td colSpan={4} className="py-0.5 pr-2 text-right">
                          Total
                        </td>
                        <td className="py-0.5 text-right">
                          {rupees(sum(lines))}
                        </td>
                        {canEdit && <td />}
                      </tr>
                    )}
                    {canEdit && (
                      <AddRow
                        section={key}
                        busy={busy}
                        onAdd={(code, qty, replaces) =>
                          add(t, key, code, qty, replaces)
                        }
                      />
                    )}
                  </tbody>
                </table>
              );
            })}
          </div>
        );
      })}
      {error && <p className="text-[12px] text-error">{error}</p>}
      <p className="text-[11px] text-secondary">
        Costs at the app&apos;s rates: Item Master net rate, with ABB parts
        built from sub-parts at the Enclosure Rates Master (project rate
        overrides not applied). &quot;wb&quot; = not priced in Item Master,
        workbook price used.
      </p>
    </div>
  );
}

function TotalChip({
  label,
  sub,
  value,
}: {
  label: string;
  sub: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-primary/5 px-3 py-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">
        {label}
      </p>
      <p className="text-[15px] font-bold text-primary tabular-nums">{value}</p>
      <p className="text-[10px] text-secondary">{sub}</p>
    </div>
  );
}

function AddRow({
  section,
  busy,
  onAdd,
}: {
  section: ArtukTemplateLine["section"];
  busy: boolean;
  onAdd: (code: string, qty: number, replaces: string | null) => void;
}) {
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("1");
  const [replaces, setReplaces] = useState("");
  const q = Number(qty);
  const ok = code.trim() !== "" && Number.isFinite(q) && q > 0;
  const isArc = section.startsWith("arc_");
  const submit = () => {
    if (!ok) return;
    onAdd(code.trim(), q, isArc && replaces.trim() ? replaces.trim() : null);
    setCode("");
    setQty("1");
    setReplaces("");
  };
  const cls =
    "rounded border border-surface-container-high bg-surface-container-lowest px-1.5 py-0.5 text-[12px]";
  return (
    <tr className="border-t border-dashed border-surface-container-high">
      <td colSpan={2} className="py-1 pr-2">
        <div className="flex flex-wrap gap-1">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Part code to add"
            className={`${cls} w-40`}
          />
          {isArc && (
            <input
              value={replaces}
              onChange={(e) => setReplaces(e.target.value)}
              placeholder="Replaces (optional)"
              className={`${cls} w-36`}
            />
          )}
        </div>
      </td>
      <td className="py-1 pr-2 text-center">
        <input
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className={`${cls} w-14 text-center`}
        />
      </td>
      <td colSpan={3} className="py-1 text-right">
        <button
          type="button"
          disabled={!ok || busy}
          onClick={submit}
          className="btn btn-outline btn-sm"
        >
          Add part
        </button>
      </td>
    </tr>
  );
}
