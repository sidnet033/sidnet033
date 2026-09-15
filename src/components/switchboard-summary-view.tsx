"use client";

import { useState } from "react";
import Link from "next/link";
import { SwitchboardHeaderBar } from "@/components/switchboard-header-bar";
import { CostBreakdownCard } from "@/components/cost-breakdown-card";
import type { LockState } from "@/components/revision-lock-controls";
import type { SwitchboardContext } from "@/lib/switchboard-context";
import type { CostBreakdown } from "@/lib/switchboard-cost";

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function SwitchboardSummaryView({
  ctx,
  currentUserId,
  currentUserName,
  isAdmin,
  breakdown,
  bayCount,
  feederCount,
}: {
  ctx: SwitchboardContext;
  currentUserId: string;
  currentUserName: string | null;
  isAdmin: boolean;
  breakdown: CostBreakdown;
  bayCount: number;
  feederCount: number;
}) {
  const [lockState, setLockState] = useState<LockState>({
    locked_by: ctx.revision.locked_by,
    archived: ctx.revision.archived,
  });
  const sb = ctx.switchboard;

  const specParts = [
    sb.form_of_separation,
    sb.amps ? `${sb.amps}A` : null,
    sb.ka ? `${sb.ka}kA` : null,
    sb.poles ? `${sb.poles}P` : null,
  ].filter(Boolean);

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col overflow-y-auto">
      <SwitchboardHeaderBar
        ctx={ctx}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        isAdmin={isAdmin}
        lockState={lockState}
        onStateChange={setLockState}
      />
      <div className="space-y-5 p-4">
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

        <CostBreakdownCard breakdown={breakdown} switchboard={sb} />

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/switchboards/${sb.id}/bom`}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Open BOM Builder →
          </Link>
          <Link
            href={`/switchboards/${sb.id}/ga`}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open GA Builder →
          </Link>
          <Link
            href={`/revisions/${ctx.revision.id}/costing`}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            View project costing →
          </Link>
        </div>
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
