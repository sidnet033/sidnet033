"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { SavingOverlay } from "@/components/saving-overlay";
import { formatMoneyDual } from "@/lib/money";
import { CURRENCIES } from "@/lib/currencies";
import type { CostBreakdown } from "@/lib/switchboard-cost";
import type { Customer, Project, Revision, Switchboard } from "@/types/database";

export type SwitchboardColumn = {
  switchboard: Switchboard;
  specSummary: string;
  breakdown: CostBreakdown;
};

type Logistics = {
  freightAmount: number;
  freightDesc: string;
  installAmount: number;
  installDesc: string;
  commissioningAmount: number;
  commissioningDesc: string;
};

function logisticsOf(revision: Revision): Logistics {
  return {
    freightAmount: revision.freight_amount,
    freightDesc: revision.freight_description ?? "",
    installAmount: revision.installation_amount,
    installDesc: revision.installation_description ?? "",
    commissioningAmount: revision.commissioning_amount,
    commissioningDesc: revision.commissioning_description ?? "",
  };
}

function profitPctSnapshot(cols: SwitchboardColumn[]): Record<string, number> {
  return Object.fromEntries(cols.map((c) => [c.switchboard.id, c.switchboard.profit_pct]));
}

export function CostingMatrix({
  revision,
  project,
  customer,
  columns: initialColumns,
  archived,
}: {
  revision: Revision;
  project: Project;
  customer: Customer | null;
  columns: SwitchboardColumn[];
  archived: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const money = (n: number) => formatMoneyDual(n, project.currency, project.exchange_rate);

  // Resync local state whenever fresh props arrive (e.g. after a
  // router.refresh() triggered by saving changes in BOM Builder, or by
  // this page's own Save below) — this is what keeps this page's cost
  // breakdown and last-saved snapshots in sync with the DB.
  const [prevInitialColumns, setPrevInitialColumns] = useState(initialColumns);
  const [columns, setColumns] = useState(initialColumns);
  const [savedProfitPct, setSavedProfitPct] = useState(() => profitPctSnapshot(initialColumns));
  const [draftProfitPct, setDraftProfitPct] = useState(() => profitPctSnapshot(initialColumns));
  if (initialColumns !== prevInitialColumns) {
    setPrevInitialColumns(initialColumns);
    setColumns(initialColumns);
    setSavedProfitPct(profitPctSnapshot(initialColumns));
    setDraftProfitPct(profitPctSnapshot(initialColumns));
  }

  const [prevRevision, setPrevRevision] = useState(revision);
  const [savedLogistics, setSavedLogistics] = useState(() => logisticsOf(revision));
  const [draftLogistics, setDraftLogistics] = useState(() => logisticsOf(revision));
  if (revision !== prevRevision) {
    setPrevRevision(revision);
    setSavedLogistics(logisticsOf(revision));
    setDraftLogistics(logisticsOf(revision));
  }

  const [saving, setSaving] = useState(false);

  const dirty =
    JSON.stringify(draftProfitPct) !== JSON.stringify(savedProfitPct) || JSON.stringify(draftLogistics) !== JSON.stringify(savedLogistics);

  function updateProfitPct(switchboardId: string, pct: number) {
    setDraftProfitPct((prev) => ({ ...prev, [switchboardId]: pct }));
  }

  function updateLogistics<K extends keyof Logistics>(field: K, value: Logistics[K]) {
    setDraftLogistics((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      for (const c of columns) {
        const next = draftProfitPct[c.switchboard.id];
        if (next !== undefined && next !== savedProfitPct[c.switchboard.id]) {
          const { error } = await supabase.from("switchboards").update({ profit_pct: next }).eq("id", c.switchboard.id);
          if (error) throw error;
        }
      }
      if (JSON.stringify(draftLogistics) !== JSON.stringify(savedLogistics)) {
        const { error } = await supabase
          .from("revisions")
          .update({
            freight_amount: draftLogistics.freightAmount,
            freight_description: draftLogistics.freightDesc || null,
            installation_amount: draftLogistics.installAmount,
            installation_description: draftLogistics.installDesc || null,
            commissioning_amount: draftLogistics.commissioningAmount,
            commissioning_description: draftLogistics.commissioningDesc || null,
          })
          .eq("id", revision.id);
        if (error) throw error;
      }
      setColumns((prev) => prev.map((c) => ({ ...c, switchboard: { ...c.switchboard, profit_pct: draftProfitPct[c.switchboard.id] ?? c.switchboard.profit_pct } })));
      setSavedProfitPct(draftProfitPct);
      setSavedLogistics(draftLogistics);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  const pctFor = (switchboardId: string) => draftProfitPct[switchboardId] ?? 0;
  const { freightAmount, freightDesc, installAmount, installDesc, commissioningAmount, commissioningDesc } = draftLogistics;

  const totalMfg = columns.reduce((s, c) => s + c.breakdown.mfgTotal * c.switchboard.qty, 0);
  const totalTender = columns.reduce((s, c) => s + c.breakdown.mfgTotal * c.switchboard.qty * (1 + pctFor(c.switchboard.id) / 100), 0);
  const avgProfitPct = columns.length > 0 ? columns.reduce((s, c) => s + pctFor(c.switchboard.id), 0) / columns.length : 0;
  const totalLogistics = freightAmount + installAmount + commissioningAmount;
  const finalPrice = totalTender + totalLogistics;

  const rowLabel = (label: string, bold = false) => (
    <td className={`sticky left-0 z-10 bg-surface-container-lowest px-3 py-1.5 ${bold ? "font-semibold text-on-surface" : "text-on-surface-variant"}`}>{label}</td>
  );

  return (
    <div className="space-y-space-lg p-margin-lg">
      <SavingOverlay show={saving} />
      <div className="flex flex-wrap items-start justify-between gap-space-md">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-headline-lg text-on-surface">Project Costing</h1>
            <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary">{project.code}</span>
          </div>
          <p className="mt-1 font-body-sm text-body-sm text-secondary">
            {columns.length} Switchboard{columns.length === 1 ? "" : "s"} · Currency:{" "}
            {CURRENCIES.find((c) => c.code === project.currency)?.label ?? project.currency}
            {customer ? ` · Client: ${customer.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-space-sm">
          {!archived && dirty && <span className="font-body-sm text-body-sm text-amber-600">Unsaved changes</span>}
          {!archived && !dirty && <span className="font-body-sm text-body-sm text-tertiary">Saved</span>}
          <button
            disabled
            title="Export coming soon"
            className="flex items-center gap-1 rounded bg-surface-container-low px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant opacity-60"
          >
            <Icon name="file_save" size={16} /> Export Costing (XLSX/PDF)
          </button>
          {!archived && (
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex items-center gap-1 rounded bg-primary px-space-lg py-space-sm font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="save" size={16} />
              {saving ? "Saving..." : "Save Changes"}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-4">
        <KpiCard label="Total Project MFG Cost" value={money(totalMfg)} />
        <KpiCard label="Average Profit Margin" value={`${avgProfitPct.toFixed(2)}%`} />
        <KpiCard label="Logistics" value={money(totalLogistics)} sub="Freight, Installation, Commissioning" />
        <KpiCard label="Final price" value={money(finalPrice)} highlight />
      </div>

      <div className="overflow-x-auto rounded-xl border border-surface-container-high bg-surface-container-lowest shadow-xs">
        <table className="w-full text-xs">
          <thead className="bg-surface-container-low text-left uppercase tracking-wide text-secondary">
            <tr>
              <th className="sticky left-0 z-10 bg-surface-container-low px-3 py-2">Cost head</th>
              {columns.map((c) => (
                <th key={c.switchboard.id} className="px-3 py-2 text-right">
                  {c.switchboard.tag}
                  {c.switchboard.qty > 1 && <span className="ml-1 font-normal normal-case text-on-surface-variant">× {c.switchboard.qty}</span>}
                  {c.specSummary && <div className="mt-0.5 font-normal normal-case text-on-surface-variant">{c.specSummary}</div>}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-surface-container bg-surface-container-low/50">
              <td colSpan={columns.length + 2} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                Direct Manufacturing Cost Breakdown
              </td>
            </tr>
            <CostRow label="Electrical" values={columns.map((c) => c.breakdown.electrical * c.switchboard.qty)} rowLabel={rowLabel} money={money} />
            <CostRow label="Busbars" values={columns.map((c) => c.breakdown.busbars * c.switchboard.qty)} rowLabel={rowLabel} money={money} />
            <CostRow label="Enclosure" values={columns.map((c) => c.breakdown.enclosure * c.switchboard.qty)} rowLabel={rowLabel} money={money} />
            <CostRow label="Wiring" values={columns.map((c) => c.breakdown.wiringAmt * c.switchboard.qty)} rowLabel={rowLabel} money={money} />
            <CostRow label="Assembly" values={columns.map((c) => c.breakdown.assemblyAmt * c.switchboard.qty)} rowLabel={rowLabel} money={money} />
            <CostRow label="Testing" values={columns.map((c) => c.breakdown.testingAmt * c.switchboard.qty)} rowLabel={rowLabel} money={money} />
            <CostRow
              label="Total MFG Cost"
              values={columns.map((c) => c.breakdown.mfgTotal * c.switchboard.qty)}
              bold
              rowLabel={rowLabel}
              money={money}
            />

            <tr className="border-t border-surface-container-high bg-surface-container-low/50">
              <td colSpan={columns.length + 2} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                Pricing
              </td>
            </tr>
            <tr className="border-t border-surface-container">
              {rowLabel("Profit %")}
              {columns.map((c) => (
                <td key={c.switchboard.id} className="px-3 py-1.5 text-right">
                  <input
                    type="number"
                    step="0.5"
                    disabled={archived}
                    value={pctFor(c.switchboard.id)}
                    onChange={(e) => updateProfitPct(c.switchboard.id, Number(e.target.value) || 0)}
                    className="w-16 rounded border border-surface-container-high px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                  />
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums text-secondary">{avgProfitPct.toFixed(2)}% avg</td>
            </tr>
            <CostRow
              label="Absolute Profit"
              values={columns.map((c) => c.breakdown.mfgTotal * c.switchboard.qty * (pctFor(c.switchboard.id) / 100))}
              rowLabel={rowLabel}
              money={money}
            />
            <tr className="border-t border-surface-container-high bg-primary/10 font-semibold">
              {rowLabel("Tender Price", true)}
              {columns.map((c) => (
                <td key={c.switchboard.id} className="px-3 py-1.5 text-right tabular-nums text-primary">
                  {money(c.breakdown.mfgTotal * c.switchboard.qty * (1 + pctFor(c.switchboard.id) / 100))}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums text-primary">{money(totalTender)}</td>
            </tr>

            <tr className="border-t border-surface-container-high bg-surface-container-low/50">
              <td colSpan={columns.length + 2} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                Logistics &amp; Site Services
              </td>
            </tr>
            <LogisticsRow
              label="Freight"
              amount={freightAmount}
              description={freightDesc}
              readOnly={archived}
              span={columns.length}
              onAmountChange={(v) => updateLogistics("freightAmount", v)}
              onDescChange={(v) => updateLogistics("freightDesc", v)}
            />
            <LogisticsRow
              label="Installation"
              amount={installAmount}
              description={installDesc}
              readOnly={archived}
              span={columns.length}
              onAmountChange={(v) => updateLogistics("installAmount", v)}
              onDescChange={(v) => updateLogistics("installDesc", v)}
            />
            <LogisticsRow
              label="Commissioning"
              amount={commissioningAmount}
              description={commissioningDesc}
              readOnly={archived}
              span={columns.length}
              onAmountChange={(v) => updateLogistics("commissioningAmount", v)}
              onDescChange={(v) => updateLogistics("commissioningDesc", v)}
            />
            <tr className="border-t border-surface-container-high bg-surface-container-low font-semibold">
              {rowLabel("Total Logistics", true)}
              <td colSpan={columns.length} />
              <td className="px-3 py-1.5 text-right tabular-nums">{money(totalLogistics)}</td>
            </tr>

            <tr className="border-t-2 border-surface-container-high bg-primary/10 font-semibold">
              {rowLabel("Final Price", true)}
              <td colSpan={columns.length} />
              <td className="px-3 py-2 text-right tabular-nums text-primary">{money(finalPrice)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CostRow({
  label,
  values,
  bold = false,
  rowLabel,
  money,
}: {
  label: string;
  values: number[];
  bold?: boolean;
  rowLabel: (label: string, bold?: boolean) => React.ReactNode;
  money: (n: number) => string;
}) {
  const total = values.reduce((s, v) => s + v, 0);
  return (
    <tr className={`border-t border-surface-container ${bold ? "font-semibold text-on-surface" : ""}`}>
      {rowLabel(label, bold)}
      {values.map((v, i) => (
        <td key={i} className="px-3 py-1.5 text-right tabular-nums">
          {money(v)}
        </td>
      ))}
      <td className="px-3 py-1.5 text-right tabular-nums">{money(total)}</td>
    </tr>
  );
}

function LogisticsRow({
  label,
  amount,
  description,
  readOnly,
  span,
  onAmountChange,
  onDescChange,
}: {
  label: string;
  amount: number;
  description: string;
  readOnly: boolean;
  span: number;
  onAmountChange: (v: number) => void;
  onDescChange: (v: string) => void;
}) {
  return (
    <tr className="border-t border-surface-container">
      <td className="sticky left-0 z-10 bg-surface-container-lowest px-3 py-1.5 text-on-surface-variant">{label}</td>
      <td colSpan={span} className="px-3 py-1.5">
        <input
          disabled={readOnly}
          value={description}
          onChange={(e) => onDescChange(e.target.value)}
          placeholder="Remarks..."
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-secondary focus:border-surface-container-high disabled:bg-transparent"
        />
      </td>
      <td className="px-3 py-1.5 text-right">
        <input
          type="number"
          disabled={readOnly}
          value={amount}
          onChange={(e) => onAmountChange(Number(e.target.value) || 0)}
          className="w-28 rounded border border-surface-container-high px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
        />
      </td>
    </tr>
  );
}

function KpiCard({ label, value, sub, highlight = false }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-space-md shadow-sm ${highlight ? "bg-primary text-on-primary" : "bg-surface-container-lowest"}`}>
      <div className="flex items-center justify-between">
        <p className={`font-label-md text-label-md uppercase tracking-wider ${highlight ? "text-on-primary/70" : "text-secondary"}`}>{label}</p>
        {highlight && <span className="rounded bg-white/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">Offer</span>}
      </div>
      <p className={`mt-1 font-display text-headline-lg ${highlight ? "text-on-primary" : "text-on-surface"}`}>{value}</p>
      {sub && <p className={`mt-0.5 font-body-sm text-body-sm ${highlight ? "text-on-primary/70" : "text-on-surface-variant"}`}>{sub}</p>}
    </div>
  );
}
