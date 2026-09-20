import { createClient } from "@/lib/supabase/server";
import { getSwitchboardCostBreakdown } from "@/lib/switchboard-cost";
import { ProjectsTree, type CustomerNode, type ProjectNode, type RevisionNode, type SwitchboardNode } from "@/components/projects-tree";
import { Icon } from "@/components/icon";
import type { Customer, Project, Revision, Switchboard } from "@/types/database";

export const dynamic = "force-dynamic";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: customers }, { data: projects }, { data: revisions }, { data: switchboards }, { data: verticals }, { count: itemCount }] =
    await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("revisions").select("*").order("revision_number"),
      supabase.from("switchboards").select("*").order("sort_order"),
      supabase.from("verticals").select("id, switchboard_id"),
      supabase.from("item_master").select("*", { count: "exact", head: true }),
    ]);

  const switchboardRows = (switchboards ?? []) as Switchboard[];
  const breakdowns = await Promise.all(switchboardRows.map((sb) => getSwitchboardCostBreakdown(supabase, sb)));
  const costBySwitchboard = new Map(switchboardRows.map((sb, i) => [sb.id, breakdowns[i].mfgTotal]));

  const bayCountBySwitchboard = new Map<string, number>();
  for (const v of (verticals ?? []) as { id: string; switchboard_id: string }[]) {
    bayCountBySwitchboard.set(v.switchboard_id, (bayCountBySwitchboard.get(v.switchboard_id) ?? 0) + 1);
  }

  const lockedByIds = Array.from(new Set(switchboardRows.map((sb) => sb.locked_by).filter((v): v is string => !!v)));
  const createdByIds = Array.from(new Set(((projects ?? []) as Project[]).map((p) => p.created_by).filter((v): v is string => !!v)));
  const profileIds = Array.from(new Set([...lockedByIds, ...createdByIds]));
  const { data: profileRows } = profileIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", profileIds)
    : { data: [] };
  const profileNames = new Map(((profileRows ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));

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
        bayCount: bayCountBySwitchboard.get(sb.id) ?? 0,
        cost: costBySwitchboard.get(sb.id) ?? 0,
        lockedByName: sb.locked_by ? profileNames.get(sb.locked_by) ?? "locked" : null,
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
          createdAtLabel: formatDate(r.created_at),
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
          engineer: p.created_by ? profileNames.get(p.created_by) ?? null : null,
          createdAtLabel: formatDate(p.created_at),
          revisions: revs,
          cost: revs.reduce((s, r) => s + r.cost, 0),
          currency: p.currency,
          exchangeRate: p.exchange_rate,
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

  return (
    <div className="flex flex-col gap-space-lg px-space-lg py-space-md">
      <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-space-lg pb-space-2xl">
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

        <ProjectsTree customers={customerNodes} customerOptions={(customers ?? []) as Customer[]} />
      </div>
    </div>
  );
}
