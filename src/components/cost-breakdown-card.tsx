import { useState } from "react";
import { formatMoney } from "@/lib/money";
import type { CostBreakdown } from "@/lib/switchboard-cost";
import type { Switchboard } from "@/types/database";

export function CostBreakdownCard({
  breakdown,
  switchboard,
  readOnly = true,
  onLaborChange,
  currency,
  exchangeRate,
}: {
  breakdown: CostBreakdown;
  switchboard: Pick<Switchboard, "labor_wiring_pct" | "labor_assembly_pct" | "labor_testing_pct">;
  readOnly?: boolean;
  onLaborChange?: (field: "labor_wiring_pct" | "labor_assembly_pct" | "labor_testing_pct", value: number) => void;
  currency: string;
  exchangeRate: number;
}) {
  const rmShare = breakdown.mfgTotal > 0 ? (breakdown.rmTotal / breakdown.mfgTotal) * 100 : 0;
  const valueAddShare = 100 - rmShare;
  const money = (n: number) => formatMoney(n, currency, exchangeRate);

  return (
    <div className="space-y-space-sm">
      <h3 className="font-headline-md text-headline-md text-on-surface">Cost Breakdown</h3>
      <div className="grid grid-cols-1 gap-space-md lg:grid-cols-3">
        <div className="space-y-1.5 rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
          <p className="flex items-center gap-1.5 font-label-md text-label-md text-on-surface-variant">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-on-primary">1</span>
            Raw Materials (RM)
          </p>
          <Row label="Electrical" value={money(breakdown.electrical)} />
          <Row label="Enclosure" value={money(breakdown.enclosure)} />
          <Row label="Busbars" value={money(breakdown.busbars)} />
          <Row label="Total RM Cost" value={money(breakdown.rmTotal)} bold />
        </div>
        <div className="space-y-1.5 rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
          <p className="flex items-center gap-1.5 font-label-md text-label-md text-on-surface-variant">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-tertiary text-[10px] font-bold text-on-tertiary">2</span>
            Labor (% of RM)
          </p>
          {onLaborChange ? (
            <>
              <PctRow
                label="Wiring"
                pct={switchboard.labor_wiring_pct}
                amount={breakdown.wiringAmt}
                readOnly={readOnly}
                onChange={(v) => onLaborChange("labor_wiring_pct", v)}
                money={money}
              />
              <PctRow
                label="Assembly"
                pct={switchboard.labor_assembly_pct}
                amount={breakdown.assemblyAmt}
                readOnly={readOnly}
                onChange={(v) => onLaborChange("labor_assembly_pct", v)}
                money={money}
              />
              <PctRow
                label="Testing"
                pct={switchboard.labor_testing_pct}
                amount={breakdown.testingAmt}
                readOnly={readOnly}
                onChange={(v) => onLaborChange("labor_testing_pct", v)}
                money={money}
              />
            </>
          ) : (
            <>
              <Row label={`Wiring ${switchboard.labor_wiring_pct}%`} value={money(breakdown.wiringAmt)} />
              <Row label={`Assembly ${switchboard.labor_assembly_pct}%`} value={money(breakdown.assemblyAmt)} />
              <Row label={`Testing ${switchboard.labor_testing_pct}%`} value={money(breakdown.testingAmt)} />
            </>
          )}
          <Row label="Total Adders" value={money(breakdown.laborTotal)} bold />
        </div>
        <div className="flex flex-col justify-between rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 font-label-md text-label-md text-on-surface-variant">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-on-primary">3</span>
              Total MFG Cost
            </p>
            <span className="rounded-full bg-tertiary-container/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-tertiary">
              Grand Total
            </span>
          </div>
          <p className="mt-1 font-display text-headline-lg text-primary">{money(breakdown.mfgTotal)}</p>
          <div className="mt-3 font-body-sm text-body-sm text-secondary">
            <p>RM Share: {rmShare.toFixed(1)}%</p>
            <p>Value Add: {valueAddShare.toFixed(1)}%</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-xs ${bold ? "border-t border-surface-container pt-1.5 font-semibold text-on-surface" : "text-on-surface-variant"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function PctRow({
  label,
  pct,
  amount,
  readOnly,
  onChange,
  money,
}: {
  label: string;
  pct: number;
  amount: number;
  readOnly: boolean;
  onChange: (v: number) => void;
  money: (n: number) => string;
}) {
  const [local, setLocal] = useState(String(pct));

  return (
    <div className="flex items-center justify-between text-xs text-on-surface-variant">
      <span className="flex items-center gap-1">
        {label}
        <input
          type="number"
          step="0.1"
          disabled={readOnly}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => onChange(Number(local) || 0)}
          className="w-14 rounded border border-surface-container-high px-1 py-0.5 text-right text-xs disabled:border-transparent disabled:bg-transparent"
        />
        %
      </span>
      <span className="tabular-nums">{money(amount)}</span>
    </div>
  );
}
