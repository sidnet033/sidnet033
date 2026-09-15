"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { getSwitchboardCostBreakdown, type CostBreakdown } from "@/lib/switchboard-cost";
import type { Switchboard } from "@/types/database";

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function SwitchboardSummaryView({
  switchboardId,
  currentUserId,
  revisionArchived,
  onOpenBom,
  onOpenGa,
}: {
  switchboardId: string;
  currentUserId: string;
  revisionArchived: boolean;
  onOpenBom: () => void;
  onOpenGa: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [sb, setSb] = useState<Switchboard | null>(null);
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);
  const [bayCount, setBayCount] = useState(0);
  const [feederCount, setFeederCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: switchboard } = await supabase.from("switchboards").select("*").eq("id", switchboardId).single();
      if (!switchboard || cancelled) return;

      const [bd, { count: bays }, { count: feeders }] = await Promise.all([
        getSwitchboardCostBreakdown(supabase, switchboard as Switchboard),
        supabase
          .from("verticals")
          .select("*", { count: "exact", head: true })
          .eq("switchboard_id", switchboardId)
          .or("bay_type.is.null,bay_type.neq.unassigned"),
        supabase
          .from("placed_feeders")
          .select("*, vertical:verticals!inner(switchboard_id)", { count: "exact", head: true })
          .eq("vertical.switchboard_id", switchboardId),
      ]);

      if (cancelled) return;
      setSb(switchboard as Switchboard);
      setBreakdown(bd);
      setBayCount(bays ?? 0);
      setFeederCount(feeders ?? 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, switchboardId]);

  async function updateLaborPct(field: "labor_wiring_pct" | "labor_assembly_pct" | "labor_testing_pct", value: number) {
    if (!sb) return;
    const updated = { ...sb, [field]: value };
    setSb(updated);
    setBreakdown(await getSwitchboardCostBreakdown(supabase, updated));
    await supabase.from("switchboards").update({ [field]: value }).eq("id", switchboardId);
  }

  if (loading || !sb || !breakdown) {
    return <div className="p-8 text-sm text-slate-400">Loading...</div>;
  }

  const readOnly = revisionArchived || (sb.locked_by !== null && sb.locked_by !== currentUserId);

  const specParts = [sb.form_of_separation, sb.amps ? `${sb.amps}A` : null, sb.ka ? `${sb.ka}kA` : null, sb.poles ? `${sb.poles}P` : null].filter(
    Boolean
  );

  return (
    <div className="space-y-5 p-4">
      {readOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          <Icon name="visibility" size={15} />
          {revisionArchived
            ? "This revision is archived — read only."
            : "This switchboard is locked by another user — read only until it's released."}
        </div>
      )}

      <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
        <h1 className="font-display text-lg font-semibold text-slate-900">
          {sb.tag}
          {sb.title ? `: ${sb.title}` : ""}
        </h1>
        {specParts.length > 0 && <p className="mt-1 text-sm text-slate-500">{specParts.join(" · ")}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Bays" value={String(bayCount)} />
        <StatCard label="Feeders in BOM" value={String(feederCount)} />
        <StatCard label="MFG cost" value={money(breakdown.mfgTotal)} />
        <StatCard label="Sell price" value={money(breakdown.mfgTotal * (1 + sb.profit_pct / 100))} highlight />
      </div>

      <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Labor / Adders (% of RM)</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <PctField
            key={`wiring-${sb.labor_wiring_pct}`}
            label="Wiring"
            value={sb.labor_wiring_pct}
            readOnly={readOnly}
            onChange={(v) => updateLaborPct("labor_wiring_pct", v)}
            amount={breakdown.wiringAmt}
          />
          <PctField
            key={`assembly-${sb.labor_assembly_pct}`}
            label="Assembly"
            value={sb.labor_assembly_pct}
            readOnly={readOnly}
            onChange={(v) => updateLaborPct("labor_assembly_pct", v)}
            amount={breakdown.assemblyAmt}
          />
          <PctField
            key={`testing-${sb.labor_testing_pct}`}
            label="Testing"
            value={sb.labor_testing_pct}
            readOnly={readOnly}
            onChange={(v) => updateLaborPct("labor_testing_pct", v)}
            amount={breakdown.testingAmt}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button onClick={onOpenBom} className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
          Open BOM Builder →
        </button>
        <button
          onClick={onOpenGa}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Open GA Builder →
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold ${highlight ? "text-brand-600" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function PctField({
  label,
  value,
  readOnly,
  onChange,
  amount,
}: {
  label: string;
  value: number;
  readOnly: boolean;
  onChange: (v: number) => void;
  amount: number;
}) {
  const [local, setLocal] = useState(String(value));

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label} %</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="0.1"
          disabled={readOnly}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => onChange(Number(local) || 0)}
          className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
        />
        <span className="text-xs text-slate-400">{money(amount)}</span>
      </div>
    </div>
  );
}
