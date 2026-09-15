import { createClient } from "@/lib/supabase/server";
import { getSwitchboardCostBreakdown } from "@/lib/switchboard-cost";
import { NewProjectModal } from "@/components/new-project-modal";
import { ProjectsTree, type CustomerNode, type ProjectNode, type RevisionNode, type SwitchboardNode } from "@/components/projects-tree";
import { Icon } from "@/components/icon";
import type { Customer, Project, Revision, Switchboard } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: customers }, { data: projects }, { data: revisions }, { data: switchboards }, { count: itemCount }, { count: feederCount }] =
    await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("revisions").select("*").order("revision_number"),
      supabase.from("switchboards").select("*").order("sort_order"),
      supabase.from("item_master").select("*", { count: "exact", head: true }),
      supabase.from("feeders").select("*", { count: "exact", head: true }).eq("is_library", true),
    ]);

  const switchboardRows = (switchboards ?? []) as Switchboard[];
  const breakdowns = await Promise.all(switchboardRows.map((sb) => getSwitchboardCostBreakdown(supabase, sb)));
  const costBySwitchboard = new Map(switchboardRows.map((sb, i) => [sb.id, breakdowns[i].mfgTotal]));

  const lockedByIds = Array.from(
    new Set(((revisions ?? []) as Revision[]).map((r) => r.locked_by).filter((v): v is string => !!v))
  );
  const { data: lockers } = lockedByIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", lockedByIds)
    : { data: [] };
  const lockerNames = new Map(((lockers ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));

  const revisionGroups = new Map<string, Revision[]>();
  for (const r of (revisions ?? []) as Revision[]) {
    const list = revisionGroups.get(r.revision_group_id) ?? [];
    list.push(r);
    revisionGroups.set(r.revision_group_id, list);
  }
  const latestRevisionId = new Map<string, string>();
  for (const [groupId, list] of revisionGroups) {
    const latest = list.reduce((a, b) => (b.revision_number > a.revision_number ? b : a));
    latestRevisionId.set(groupId, latest.id);
  }

  const switchboardNodes = (revisionId: string): SwitchboardNode[] =>
    switchboardRows
      .filter((sb) => sb.revision_id === revisionId)
      .map((sb) => ({
        id: sb.id,
        tag: sb.tag,
        title: sb.title,
        specSummary: [sb.form_of_separation, sb.amps ? `${sb.amps}A` : null, sb.ka ? `${sb.ka}kA` : null]
          .filter(Boolean)
          .join(" · "),
        cost: costBySwitchboard.get(sb.id) ?? 0,
      }));

  const revisionNodes = (projectId: string): RevisionNode[] =>
    ((revisions ?? []) as Revision[])
      .filter((r) => r.project_id === projectId)
      .map((r) => {
        const boards = switchboardNodes(r.id);
        return {
          id: r.id,
          revisionNumber: r.revision_number,
          archived: r.archived,
          isLatest: latestRevisionId.get(r.revision_group_id) === r.id,
          lockedByName: r.locked_by ? lockerNames.get(r.locked_by) ?? "locked" : null,
          switchboards: boards,
          cost: boards.reduce((s, b) => s + b.cost, 0),
        };
      })
      .sort((a, b) => b.revisionNumber - a.revisionNumber);

  const projectNodes = (customerId: string | null): ProjectNode[] =>
    ((projects ?? []) as Project[])
      .filter((p) => p.customer_id === customerId)
      .map((p) => {
        const revs = revisionNodes(p.id);
        return {
          id: p.id,
          code: p.code,
          title: p.title,
          revisions: revs,
          cost: revs.reduce((s, r) => s + r.cost, 0),
        };
      });

  const customerNodes: CustomerNode[] = ((customers ?? []) as Customer[]).map((c) => {
    const projs = projectNodes(c.id);
    return { id: c.id, name: c.name, projects: projs, cost: projs.reduce((s, p) => s + p.cost, 0) };
  });

  // projects with no customer_id (shouldn't normally happen, but keep visible)
  const unassignedProjects = projectNodes(null);
  if (unassignedProjects.length > 0) {
    customerNodes.push({
      id: "__unassigned__",
      name: "No customer",
      projects: unassignedProjects,
      cost: unassignedProjects.reduce((s, p) => s + p.cost, 0),
    });
  }

  const activeRevisionCount = ((revisions ?? []) as Revision[]).filter((r) => !r.archived).length;

  return (
    <div className="max-w-6xl space-y-7 px-8 py-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">Customers, projects, revisions and switchboards at a glance.</p>
      </div>

      {(itemCount ?? 0) === 0 && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200/80 bg-amber-50/60 p-3.5 text-xs">
          <div className="flex items-start gap-2.5">
            <Icon name="warning" size={18} className="mt-0.5 text-amber-600" />
            <div>
              <span className="font-medium text-amber-950">Item master is empty</span>
              <p className="mt-0.5 text-amber-800/90">Add components before building feeders or quoting a switchboard.</p>
            </div>
          </div>
          <a href="/item-master" className="shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100/50 hover:text-amber-900">
            <Icon name="arrow_forward" size={17} />
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Active revisions" value={String(activeRevisionCount)} icon="folder_open" />
        <StatCard label="Item master lines" value={String(itemCount ?? 0)} icon="inventory_2" />
        <StatCard label="Feeders built" value={String(feederCount ?? 0)} icon="schema" />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-900">Projects</h2>
        </div>
        <NewProjectModal customers={(customers ?? []) as Customer[]} />

        <div className="mt-3">
          <ProjectsTree customers={customerNodes} />
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
