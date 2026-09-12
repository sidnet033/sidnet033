import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NewProjectForm } from "@/components/new-project-form";
import { Icon } from "@/components/icon";
import type { Project } from "@/types/database";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  quoted: "bg-blue-50 text-blue-700 border-blue-200/60",
  won: "bg-emerald-50 text-emerald-600 border-emerald-200/60",
  lost: "bg-rose-50 text-rose-600 border-rose-200/60",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: projects }, { count: itemCount }, { count: feederCount }] = await Promise.all([
    supabase.from("projects").select("*").order("created_at", { ascending: false }),
    supabase.from("item_master").select("*", { count: "exact", head: true }),
    supabase.from("feeders").select("*", { count: "exact", head: true }),
  ]);

  const rows = (projects ?? []) as Project[];
  const activeCount = rows.filter((p) => p.status === "draft" || p.status === "quoted").length;

  return (
    <div className="max-w-5xl space-y-7 px-8 py-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">Your projects, item master and feeder master at a glance.</p>
      </div>

      {(itemCount ?? 0) === 0 && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200/80 bg-amber-50/60 p-3.5 text-xs">
          <div className="flex items-start gap-2.5">
            <Icon name="warning" size={18} className="mt-0.5 text-amber-600" />
            <div>
              <span className="font-medium text-amber-950">Item master is empty</span>
              <p className="mt-0.5 text-amber-800/90">
                Add components before building feeders or quoting a switchboard.
              </p>
            </div>
          </div>
          <Link
            href="/item-master"
            className="shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100/50 hover:text-amber-900"
          >
            <Icon name="arrow_forward" size={17} />
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Active projects" value={String(activeCount)} icon="folder_open" />
        <StatCard label="Item master lines" value={String(itemCount ?? 0)} icon="inventory_2" />
        <StatCard label="Feeders built" value={String(feederCount ?? 0)} icon="schema" />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-900">Projects &amp; Quotes</h2>
        </div>
        <NewProjectForm />

        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Margin</th>
                <th className="px-4 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/projects/${p.id}/ga`} className="font-medium text-slate-900 hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.customer_name || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLES[p.status] ?? ""}`}>
                      {p.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.margin_pct}%</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(p.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No projects yet. Create one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <Icon name={icon} size={17} className="text-slate-400" />
      </div>
      <p className="mt-1 font-display text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
