import type { CostBreakdown } from "@/lib/switchboard-cost";
import type { Switchboard } from "@/types/database";

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function CostBreakdownCard({
  breakdown,
  switchboard,
}: {
  breakdown: CostBreakdown;
  switchboard: Pick<Switchboard, "labor_wiring_pct" | "labor_assembly_pct" | "labor_testing_pct">;
}) {
  const rmShare = breakdown.mfgTotal > 0 ? (breakdown.rmTotal / breakdown.mfgTotal) * 100 : 0;
  const valueAddShare = 100 - rmShare;

  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Cost Breakdown</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Raw Materials (RM)</p>
          <Row label="Electrical" value={money(breakdown.electrical)} />
          <Row label="Enclosure" value={money(breakdown.enclosure)} />
          <Row label="Busbars" value={money(breakdown.busbars)} />
          <Row label="Total RM" value={money(breakdown.rmTotal)} bold />
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Labor (% of RM)</p>
          <Row label={`Wiring ${switchboard.labor_wiring_pct}%`} value={money(breakdown.wiringAmt)} />
          <Row label={`Assembly ${switchboard.labor_assembly_pct}%`} value={money(breakdown.assemblyAmt)} />
          <Row label={`Testing ${switchboard.labor_testing_pct}%`} value={money(breakdown.testingAmt)} />
          <Row label="Total Adders" value={money(breakdown.laborTotal)} bold />
        </div>
        <div className="flex flex-col justify-between rounded-lg bg-slate-50 p-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total MFG Cost</p>
            <p className="mt-1 font-display text-xl font-semibold text-slate-900">{money(breakdown.mfgTotal)}</p>
          </div>
          <div className="mt-3 text-[11px] text-slate-500">
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
    <div className={`flex items-center justify-between text-xs ${bold ? "border-t border-slate-100 pt-1.5 font-semibold text-slate-800" : "text-slate-600"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
