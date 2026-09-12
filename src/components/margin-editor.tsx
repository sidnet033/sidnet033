"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/types/database";

export function MarginEditor({
  project,
  totalCost,
  readOnly = false,
}: {
  project: Project;
  totalCost: number;
  readOnly?: boolean;
}) {
  const [margin, setMargin] = useState(project.margin_pct);
  const [saving, setSaving] = useState(false);

  const sellPrice = totalCost * (1 + margin / 100);
  const marginAmount = sellPrice - totalCost;

  async function saveMargin(value: number) {
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("projects")
      .update({ margin_pct: value, updated_at: new Date().toISOString() })
      .eq("id", project.id);
    setSaving(false);
  }

  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Margin % (applied on cost)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.5"
              value={margin}
              disabled={readOnly}
              onChange={(e) => setMargin(Number(e.target.value) || 0)}
              onBlur={() => saveMargin(margin)}
              className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500"
            />
            <span className="text-sm text-slate-500">%{saving ? " — saving..." : ""}</span>
          </div>
        </div>

        <div className="flex gap-8 text-right">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Cost</p>
            <p className="font-display text-lg font-medium text-slate-700">
              ₹{totalCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Margin</p>
            <p className="font-display text-lg font-medium text-slate-700">
              ₹{marginAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Sell price</p>
            <p className="font-display text-xl font-semibold text-brand-600">
              ₹{sellPrice.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
