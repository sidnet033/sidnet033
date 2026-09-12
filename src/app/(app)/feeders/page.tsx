import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getFeederCosts } from "@/lib/feeder-cost";
import { NewFeederButton } from "@/components/new-feeder-button";
import type { Feeder } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FeedersPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  const { data: feeders } = await supabase.from("feeders").select("*").order("name");
  const { data: lines } = await supabase.from("feeder_items").select("feeder_id");
  const costByFeederTotal = await getFeederCosts(supabase);

  const lineCounts = new Map<string, number>();
  for (const line of (lines ?? []) as { feeder_id: string }[]) {
    lineCounts.set(line.feeder_id, (lineCounts.get(line.feeder_id) ?? 0) + 1);
  }

  const rows = (feeders ?? []) as Feeder[];

  return (
    <div className="max-w-6xl space-y-4 px-8 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-900">Feeder Master</h1>
          <p className="text-sm text-slate-500">
            Reusable feeder templates built from item master lines. Drag these onto the GA canvas.
          </p>
        </div>
        {isAdmin && <NewFeederButton />}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Feeder</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Lines</th>
              <th className="px-4 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/feeders/${f.id}`} className="font-medium text-slate-900 hover:underline">
                    {f.name}
                  </Link>
                  {f.description && <p className="text-xs text-slate-400">{f.description}</p>}
                </td>
                <td className="px-4 py-3 text-slate-600">{f.category || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{lineCounts.get(f.id) ?? 0}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                  ₹{(costByFeederTotal.get(f.id) ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  No feeders yet. {isAdmin ? "Create one above." : "Ask an admin to build the feeder master."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
