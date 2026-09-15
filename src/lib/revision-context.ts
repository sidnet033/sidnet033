import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSwitchboardCostBreakdown, type CostBreakdown } from "@/lib/switchboard-cost";
import type { Customer, Project, Revision, Switchboard } from "@/types/database";

export type SiblingRevision = { id: string; revision_number: number; status: string };

export type SwitchboardListItem = {
  switchboard: Switchboard;
  lockedByName: string | null;
  specSummary: string;
  breakdown: CostBreakdown;
};

export type RevisionContext = {
  revision: Revision;
  project: Project;
  customer: Customer | null;
  siblingRevisions: SiblingRevision[];
  switchboards: SwitchboardListItem[];
};

// Fetched once by the unified /revisions/[id] workspace page: the
// revision, its project/customer, sibling revisions (for the Rev
// picker), and the list of switchboards belonging to this revision
// (with locker names + rolled-up cost) for the Project Detail tab.
export async function getRevisionContext(revisionId: string): Promise<RevisionContext> {
  const supabase = await createClient();

  const { data: revision } = await supabase.from("revisions").select("*").eq("id", revisionId).single();
  if (!revision) notFound();

  const { data: project } = await supabase.from("projects").select("*").eq("id", revision.project_id).single();
  if (!project) notFound();

  const [{ data: customer }, { data: siblingRevisions }, { data: switchboardRows }] = await Promise.all([
    project.customer_id
      ? supabase.from("customers").select("*").eq("id", project.customer_id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("revisions")
      .select("id, revision_number, status")
      .eq("revision_group_id", revision.revision_group_id)
      .order("revision_number"),
    supabase.from("switchboards").select("*").eq("revision_id", revisionId).order("sort_order"),
  ]);

  const boards = (switchboardRows ?? []) as Switchboard[];

  const lockedByIds = Array.from(new Set(boards.map((b) => b.locked_by).filter((v): v is string => !!v)));
  const { data: lockers } = lockedByIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", lockedByIds)
    : { data: [] };
  const lockerNames = new Map(
    ((lockers ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name])
  );

  const breakdowns = await Promise.all(boards.map((sb) => getSwitchboardCostBreakdown(supabase, sb)));

  const switchboards: SwitchboardListItem[] = boards.map((sb, i) => ({
    switchboard: sb,
    lockedByName: sb.locked_by ? lockerNames.get(sb.locked_by) ?? "locked" : null,
    specSummary: [sb.form_of_separation, sb.amps ? `${sb.amps}A` : null, sb.ka ? `${sb.ka}kA` : null]
      .filter(Boolean)
      .join(" · "),
    breakdown: breakdowns[i],
  }));

  return {
    revision: revision as Revision,
    project: project as Project,
    customer: (customer as Customer | null) ?? null,
    siblingRevisions: (siblingRevisions ?? []) as SiblingRevision[],
    switchboards,
  };
}
