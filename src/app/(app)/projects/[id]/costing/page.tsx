import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MarginEditor } from "@/components/margin-editor";
import type { ItemMaster, Project } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function CostingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("*").eq("id", id).single();
  if (!project) notFound();

  const { data: verticals } = await supabase
    .from("verticals")
    .select("id, name")
    .eq("project_id", id)
    .order("sort_order");
  const verticalIds = (verticals ?? []).map((v) => v.id);

  const { data: placed } = verticalIds.length
    ? await supabase
        .from("placed_feeders")
        .select("id, vertical_id, feeder_id, qty, feeder:feeders(id, name)")
        .in("vertical_id", verticalIds)
    : { data: [] };

  const feederIds = Array.from(
    new Set(((placed ?? []) as { feeder_id: string }[]).map((p) => p.feeder_id))
  );

  const { data: feederLines } = feederIds.length
    ? await supabase
        .from("feeder_items")
        .select("feeder_id, qty, item:item_master(*)")
        .in("feeder_id", feederIds)
    : { data: [] };

  type PlacedRow = { id: string; vertical_id: string; feeder_id: string; qty: number; feeder: { id: string; name: string } };
  type FeederLineRow = { feeder_id: string; qty: number; item: ItemMaster };

  const placedRows = (placed ?? []) as unknown as PlacedRow[];
  const feederLineRows = (feederLines ?? []) as unknown as FeederLineRow[];

  // qty of each feeder needed, project-wide (sum across all verticals)
  const feederQty = new Map<string, number>();
  for (const p of placedRows) {
    feederQty.set(p.feeder_id, (feederQty.get(p.feeder_id) ?? 0) + p.qty);
  }

  // item-level BOM: item -> { item, qty, cost }
  const bom = new Map<string, { item: ItemMaster; qty: number }>();
  for (const line of feederLineRows) {
    const feederCount = feederQty.get(line.feeder_id) ?? 0;
    if (feederCount === 0) continue;
    const entry = bom.get(line.item.id) ?? { item: line.item, qty: 0 };
    entry.qty += line.qty * feederCount;
    bom.set(line.item.id, entry);
  }
  const bomRows = Array.from(bom.values()).sort((a, b) => a.item.item_code.localeCompare(b.item.item_code));
  const totalCost = bomRows.reduce((sum, r) => sum + r.qty * r.item.unit_cost, 0);

  // per-vertical subtotal
  const verticalCost = new Map<string, { name: string; cost: number; feederCount: number }>();
  for (const v of verticals ?? []) verticalCost.set(v.id, { name: v.name, cost: 0, feederCount: 0 });
  const feederCostById = new Map<string, number>();
  for (const line of feederLineRows) {
    feederCostById.set(line.feeder_id, (feederCostById.get(line.feeder_id) ?? 0) + line.qty * line.item.unit_cost);
  }
  for (const p of placedRows) {
    const entry = verticalCost.get(p.vertical_id);
    if (!entry) continue;
    entry.cost += p.qty * (feederCostById.get(p.feeder_id) ?? 0);
    entry.feederCount += 1;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{project.name} — Costing</h1>
          <p className="text-sm text-slate-500">{project.customer_name || "No customer set"}</p>
        </div>
        <Link href={`/projects/${project.id}/ga`} className="text-sm text-slate-500 hover:underline">
          ← Back to GA canvas
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Verticals" value={String((verticals ?? []).length)} />
        <SummaryCard label="BOM lines" value={String(bomRows.length)} />
        <SummaryCard label="Total BOM cost" value={`₹${totalCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
      </div>

      <MarginEditor project={project as Project} totalCost={totalCost} />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Cost by vertical</h2>
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Vertical</th>
                <th className="px-4 py-2">Feeders placed</th>
                <th className="px-4 py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(verticalCost.values()).map((v) => (
                <tr key={v.name} className="border-t border-slate-100">
                  <td className="px-4 py-2">{v.name}</td>
                  <td className="px-4 py-2">{v.feederCount}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    ₹{v.cost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
              {verticalCost.size === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                    No verticals yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Full BOM (rolled up across the whole switchboard)</h2>
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2">UOM</th>
                <th className="px-3 py-2 text-right">Unit cost</th>
                <th className="px-3 py-2 text-right">Line cost</th>
              </tr>
            </thead>
            <tbody>
              {bomRows.map((r) => (
                <tr key={r.item.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{r.item.item_code}</td>
                  <td className="px-3 py-2">{r.item.description}</td>
                  <td className="px-3 py-2 text-slate-500">{r.item.category || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.qty}</td>
                  <td className="px-3 py-2 text-slate-500">{r.item.uom}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    ₹{r.item.unit_cost.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    ₹{(r.qty * r.item.unit_cost).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
              {bomRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    Nothing placed on the GA canvas yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-medium">
                <td colSpan={6} className="px-3 py-2 text-right">
                  Total
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  ₹{totalCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
