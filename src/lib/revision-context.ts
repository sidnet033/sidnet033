import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSwitchboardCostBreakdown, type CostBreakdown } from "@/lib/switchboard-cost";
import type { Customer, Profile, Project, Revision, Switchboard } from "@/types/database";

export type SiblingRevision = { id: string; revision_number: number; status: string };

export type SwitchboardListItem = {
  switchboard: Switchboard;
  lockedByName: string | null;
  updatedByName: string | null;
  typeName: string | null;
  specSummary: string;
  breakdown: CostBreakdown;
};

export type RevisionContext = {
  revision: Revision;
  project: Project;
  customer: Customer | null;
  createdByName: string | null;
  consultantName: string | null;
  salesExecName: string | null;
  ownerName: string | null;
  siblingRevisions: SiblingRevision[];
  switchboards: SwitchboardListItem[];
  allUsers: { id: string; full_name: string | null; email: string | null }[];
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

  const [{ data: customer }, { data: siblingRevisions }, { data: switchboardRows }, { data: allUserRows }] = await Promise.all([
    project.customer_id
      ? supabase.from("customers").select("*").eq("id", project.customer_id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("revisions")
      .select("id, revision_number, status")
      .eq("revision_group_id", revision.revision_group_id)
      .order("revision_number"),
    supabase.from("switchboards").select("*").eq("revision_id", revisionId).order("sort_order"),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
  ]);

  const boards = (switchboardRows ?? []) as Switchboard[];
  const allUsers = (allUserRows ?? []) as Profile[];
  const profileNames = new Map(allUsers.map((p) => [p.id, p.full_name]));

  const typeIds = Array.from(new Set(boards.map((b) => b.switchboard_type_id).filter((v): v is string => !!v)));
  const { data: typeRows } = typeIds.length
    ? await supabase.from("switchboard_types").select("id, name").in("id", typeIds)
    : { data: [] };
  const typeNames = new Map(((typeRows ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));

  const [{ data: consultant }, { data: salesExec }] = await Promise.all([
    project.consultant_id
      ? supabase.from("consultants").select("name").eq("id", project.consultant_id).single()
      : Promise.resolve({ data: null }),
    project.sales_exec_id
      ? supabase.from("sales_execs").select("name").eq("id", project.sales_exec_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const breakdowns = await Promise.all(boards.map((sb) => getSwitchboardCostBreakdown(supabase, sb)));

  const switchboards: SwitchboardListItem[] = boards.map((sb, i) => ({
    switchboard: sb,
    lockedByName: sb.locked_by ? profileNames.get(sb.locked_by) ?? "locked" : null,
    updatedByName: sb.updated_by ? profileNames.get(sb.updated_by) ?? null : null,
    typeName: sb.switchboard_type_id ? typeNames.get(sb.switchboard_type_id) ?? null : null,
    specSummary: [sb.form_of_separation, sb.amps ? `${sb.amps}A` : null, sb.ka ? `${sb.ka}kA` : null]
      .filter(Boolean)
      .join(" · "),
    breakdown: breakdowns[i],
  }));

  return {
    revision: revision as Revision,
    project: project as Project,
    customer: (customer as Customer | null) ?? null,
    createdByName: project.created_by ? profileNames.get(project.created_by) ?? null : null,
    consultantName: (consultant as { name: string } | null)?.name ?? null,
    salesExecName: (salesExec as { name: string } | null)?.name ?? null,
    ownerName: project.owner_id ? profileNames.get(project.owner_id) ?? null : null,
    siblingRevisions: (siblingRevisions ?? []) as SiblingRevision[],
    switchboards,
    allUsers,
  };
}
