"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { RevisionLockControls, type LockState } from "@/components/revision-lock-controls";
import { Icon } from "@/components/icon";
import type { SiblingRevision } from "@/lib/switchboard-context";
import type { CostBreakdown } from "@/lib/switchboard-cost";
import type { Customer, Project, Revision, Switchboard } from "@/types/database";

export type SwitchboardColumn = {
  switchboard: Switchboard;
  specSummary: string;
  breakdown: CostBreakdown;
};

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function CostingMatrix({
  revision,
  project,
  customer,
  columns: initialColumns,
  currentUserId,
  currentUserName,
  isAdmin,
  lockedByName,
  siblingRevisions,
}: {
  revision: Revision;
  project: Project;
  customer: Customer | null;
  columns: SwitchboardColumn[];
  currentUserId: string;
  currentUserName: string | null;
  isAdmin: boolean;
  lockedByName: string | null;
  siblingRevisions: SiblingRevision[];
}) {
  const supabase = useMemo(() => createClient(), []);

  const [lockState, setLockState] = useState<LockState>({ locked_by: revision.locked_by, archived: revision.archived });
  const readOnly = lockState.archived || (lockState.locked_by !== null && lockState.locked_by !== currentUserId);

  const [columns, setColumns] = useState(initialColumns);
  const [freightAmount, setFreightAmount] = useState(revision.freight_amount);
  const [freightDesc, setFreightDesc] = useState(revision.freight_description ?? "");
  const [installAmount, setInstallAmount] = useState(revision.installation_amount);
  const [installDesc, setInstallDesc] = useState(revision.installation_description ?? "");
  const [commissioningAmount, setCommissioningAmount] = useState(revision.commissioning_amount);
  const [commissioningDesc, setCommissioningDesc] = useState(revision.commissioning_description ?? "");

  async function updateProfitPct(switchboardId: string, pct: number) {
    setColumns(columns.map((c) => (c.switchboard.id === switchboardId ? { ...c, switchboard: { ...c.switchboard, profit_pct: pct } } : c)));
    await supabase.from("switchboards").update({ profit_pct: pct }).eq("id", switchboardId);
  }

  async function saveLogistics(field: keyof Revision, value: number | string | null) {
    await supabase.from("revisions").update({ [field]: value }).eq("id", revision.id);
  }

  const totalMfg = columns.reduce((s, c) => s + c.breakdown.mfgTotal, 0);
  const totalTender = columns.reduce((s, c) => s + c.breakdown.mfgTotal * (1 + c.switchboard.profit_pct / 100), 0);
  const avgProfitPct = columns.length > 0 ? columns.reduce((s, c) => s + c.switchboard.profit_pct, 0) / columns.length : 0;
  const totalLogistics = freightAmount + installAmount + commissioningAmount;
  const finalPrice = totalTender + totalLogistics;

  const rowLabel = (label: string, bold = false) => (
    <td className={`sticky left-0 z-10 bg-white px-3 py-1.5 ${bold ? "font-semibold text-slate-800" : "text-slate-600"}`}>{label}</td>
  );

  return (
    <div className="max-w-6xl space-y-5 px-8 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <Link href="/" className="hover:underline">
              Projects
            </Link>
            <span>/</span>
            <span className="text-slate-700">
              {project.code}
              {customer ? ` · ${customer.name}` : ""}
            </span>
            <span>/</span>
            <span className="font-medium text-slate-900">Costing</span>
          </div>
          <h1 className="mt-1 font-display text-xl font-semibold text-slate-900">{project.title} — Project Costing</h1>
          <p className="text-sm text-slate-500">{columns.length} switchboard(s)</p>
        </div>
        <RevisionLockControls
          revisionId={revision.id}
          initialLockedBy={revision.locked_by}
          initialLockedByName={lockedByName}
          initialArchived={revision.archived}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          isAdmin={isAdmin}
          createdBy={revision.created_by}
          revisionNumber={revision.revision_number}
          siblingRevisions={siblingRevisions}
          onStateChange={setLockState}
        />
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          <Icon name="visibility" size={15} />
          {lockState.archived ? "This revision is archived — read only." : "Locked by another user — editing is off until it's released."}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <KpiCard label="Total Project MFG Cost" value={money(totalMfg)} />
        <KpiCard label="Average Profit Margin" value={`${avgProfitPct.toFixed(2)}%`} />
        <KpiCard label="Logistics" value={money(totalLogistics)} sub="Freight, Installation, Commissioning" />
        <KpiCard label="Final price" value={money(finalPrice)} highlight />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Cost head</th>
              {columns.map((c) => (
                <th key={c.switchboard.id} className="px-3 py-2 text-right">
                  <Link href={`/switchboards/${c.switchboard.id}/summary`} className="hover:underline">
                    {c.switchboard.tag}
                  </Link>
                  {c.specSummary && <div className="mt-0.5 font-normal normal-case text-slate-400">{c.specSummary}</div>}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100 bg-slate-50/50">
              <td colSpan={columns.length + 2} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Direct Manufacturing Cost Breakdown
              </td>
            </tr>
            <CostRow label="Electrical" values={columns.map((c) => c.breakdown.electrical)} rowLabel={rowLabel} />
            <CostRow label="Busbars" values={columns.map((c) => c.breakdown.busbars)} rowLabel={rowLabel} />
            <CostRow label="Enclosure" values={columns.map((c) => c.breakdown.enclosure)} rowLabel={rowLabel} />
            <CostRow label="Wiring" values={columns.map((c) => c.breakdown.wiringAmt)} rowLabel={rowLabel} />
            <CostRow label="Assembly" values={columns.map((c) => c.breakdown.assemblyAmt)} rowLabel={rowLabel} />
            <CostRow label="Testing" values={columns.map((c) => c.breakdown.testingAmt)} rowLabel={rowLabel} />
            <CostRow label="Total MFG Cost" values={columns.map((c) => c.breakdown.mfgTotal)} bold rowLabel={rowLabel} />

            <tr className="border-t border-slate-200 bg-slate-50/50">
              <td colSpan={columns.length + 2} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Pricing
              </td>
            </tr>
            <tr className="border-t border-slate-100">
              {rowLabel("Profit %")}
              {columns.map((c) => (
                <td key={c.switchboard.id} className="px-3 py-1.5 text-right">
                  <input
                    type="number"
                    step="0.5"
                    disabled={readOnly}
                    value={c.switchboard.profit_pct}
                    onChange={(e) => updateProfitPct(c.switchboard.id, Number(e.target.value) || 0)}
                    className="w-16 rounded border border-slate-200 px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
                  />
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{avgProfitPct.toFixed(2)}% avg</td>
            </tr>
            <CostRow
              label="Absolute Profit"
              values={columns.map((c) => c.breakdown.mfgTotal * (c.switchboard.profit_pct / 100))}
              rowLabel={rowLabel}
            />
            <tr className="border-t border-slate-200 bg-brand-50/40 font-semibold">
              {rowLabel("Tender Price", true)}
              {columns.map((c) => (
                <td key={c.switchboard.id} className="px-3 py-1.5 text-right tabular-nums text-brand-700">
                  {money(c.breakdown.mfgTotal * (1 + c.switchboard.profit_pct / 100))}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums text-brand-700">{money(totalTender)}</td>
            </tr>

            <tr className="border-t border-slate-200 bg-slate-50/50">
              <td colSpan={columns.length + 2} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Logistics &amp; Site Services
              </td>
            </tr>
            <LogisticsRow
              label="Freight"
              amount={freightAmount}
              description={freightDesc}
              readOnly={readOnly}
              span={columns.length}
              onAmountChange={(v) => {
                setFreightAmount(v);
                saveLogistics("freight_amount", v);
              }}
              onDescChange={(v) => {
                setFreightDesc(v);
                saveLogistics("freight_description", v || null);
              }}
            />
            <LogisticsRow
              label="Installation"
              amount={installAmount}
              description={installDesc}
              readOnly={readOnly}
              span={columns.length}
              onAmountChange={(v) => {
                setInstallAmount(v);
                saveLogistics("installation_amount", v);
              }}
              onDescChange={(v) => {
                setInstallDesc(v);
                saveLogistics("installation_description", v || null);
              }}
            />
            <LogisticsRow
              label="Commissioning"
              amount={commissioningAmount}
              description={commissioningDesc}
              readOnly={readOnly}
              span={columns.length}
              onAmountChange={(v) => {
                setCommissioningAmount(v);
                saveLogistics("commissioning_amount", v);
              }}
              onDescChange={(v) => {
                setCommissioningDesc(v);
                saveLogistics("commissioning_description", v || null);
              }}
            />
            <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
              {rowLabel("Total Logistics", true)}
              <td colSpan={columns.length} />
              <td className="px-3 py-1.5 text-right tabular-nums">{money(totalLogistics)}</td>
            </tr>

            <tr className="border-t-2 border-slate-300 bg-brand-50 font-semibold">
              {rowLabel("Final Price", true)}
              <td colSpan={columns.length} />
              <td className="px-3 py-2 text-right tabular-nums text-brand-700">{money(finalPrice)}</td>
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
}: {
  label: string;
  values: number[];
  bold?: boolean;
  rowLabel: (label: string, bold?: boolean) => React.ReactNode;
}) {
  const total = values.reduce((s, v) => s + v, 0);
  return (
    <tr className={`border-t border-slate-100 ${bold ? "font-semibold text-slate-800" : ""}`}>
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
    <tr className="border-t border-slate-100">
      <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-slate-600">{label}</td>
      <td colSpan={span} className="px-3 py-1.5">
        <input
          disabled={readOnly}
          value={description}
          onChange={(e) => onDescChange(e.target.value)}
          placeholder="Description..."
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-slate-500 focus:border-slate-200 disabled:bg-transparent"
        />
      </td>
      <td className="px-3 py-1.5 text-right">
        <input
          type="number"
          disabled={readOnly}
          value={amount}
          onChange={(e) => onAmountChange(Number(e.target.value) || 0)}
          className="w-28 rounded border border-slate-200 px-1 py-0.5 text-right disabled:border-transparent disabled:bg-transparent"
        />
      </td>
    </tr>
  );
}

function KpiCard({ label, value, sub, highlight = false }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 shadow-xs ${highlight ? "border-brand-200 bg-brand-50" : "border-slate-200/90 bg-white"}`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold ${highlight ? "text-brand-700" : "text-slate-900"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
