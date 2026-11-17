import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSwitchboardCostBreakdown, type CostBreakdown } from "@/lib/switchboard-cost";
import type { Customer, Profile, Project, Revision, Switchboard } from "@/types/database";

export type SiblingRevision = { id: string; revision_number: number; status: string };

// A switchboard's bays as laid out in GA Builder, for the project PDFs'
// feeder arrangement: line-up order, bays numbered like the GA (alleys
// unnumbered), each face's feeders (name x qty) top to bottom.
export type FeederQty = { name: string; qty: number };
export type BayFeeders = {
  name: string;
  number: number | null;
  kind: string | null;
  widthMm: number | null;
  front: FeederQty[];
  rear: FeederQty[];
};

export type SwitchboardListItem = {
  switchboard: Switchboard;
  lockedByName: string | null;
  updatedByName: string | null;
  typeName: string | null;
  specSummary: string;
  breakdown: CostBreakdown;
  bays: BayFeeders[];
  /** feeders still in GA Builder's available list (not placed in a bay) */
  unplaced: FeederQty[];
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

  // bays + placed feeders of every board, for the feeder arrangement
  const boardIds = boards.map((b) => b.id);
  const { data: vRows } = boardIds.length
    ? await supabase.from("verticals").select("id, switchboard_id, name, bay_type, width_mm, sort_order").in("switchboard_id", boardIds)
    : { data: [] };
  type VRow = { id: string; switchboard_id: string; name: string; bay_type: string | null; width_mm: number | null; sort_order: number };
  const verticals = (vRows ?? []) as VRow[];
  const { data: pRows } = verticals.length
    ? await supabase
        .from("placed_feeders")
        .select("vertical_id, qty, sort_order, tier_number, face, feeder:feeders(name)")
        .in("vertical_id", verticals.map((v) => v.id))
    : { data: [] };
  type PRow = { vertical_id: string; qty: number; sort_order: number; tier_number: number; face: string | null; feeder: { name: string } | null };
  const placed = (pRows ?? []) as unknown as PRow[];
  const feedersOf = (vid: string, face: "front" | "rear" | null): FeederQty[] => {
    const merged = new Map<string, number>();
    placed
      .filter((p) => p.vertical_id === vid && (face == null || (p.face === "rear" ? "rear" : "front") === face))
      .sort((a, b) => a.tier_number - b.tier_number || a.sort_order - b.sort_order)
      .forEach((p) => {
        const n = p.feeder?.name ?? "Feeder";
        merged.set(n, (merged.get(n) ?? 0) + (p.qty ?? 1));
      });
    return [...merged].map(([name, qty]) => ({ name, qty }));
  };
  const layoutOf = (sbId: string): { bays: BayFeeders[]; unplaced: FeederQty[] } => {
    const vs = verticals.filter((v) => v.switchboard_id === sbId);
    const unassigned = vs.find((v) => v.bay_type === "unassigned");
    let n = 0;
    const bays = vs
      .filter((v) => v.bay_type !== "unassigned")
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => {
        const alley = v.bay_type === "cable_alley" || v.bay_type === "busbar_alley" || v.bay_type === "dummy_bay";
        return {
          name: v.name,
          number: alley ? null : ++n,
          kind: v.bay_type,
          widthMm: v.width_mm != null ? Number(v.width_mm) : null,
          front: feedersOf(v.id, "front"),
          rear: feedersOf(v.id, "rear"),
        };
      });
    return { bays, unplaced: unassigned ? feedersOf(unassigned.id, null) : [] };
  };

  const switchboards: SwitchboardListItem[] = boards.map((sb, i) => ({
    switchboard: sb,
    lockedByName: sb.locked_by ? profileNames.get(sb.locked_by) ?? "locked" : null,
    updatedByName: sb.updated_by ? profileNames.get(sb.updated_by) ?? null : null,
    typeName: sb.switchboard_type_id ? typeNames.get(sb.switchboard_type_id) ?? null : null,
    specSummary: [sb.form_of_separation, sb.amps ? `${sb.amps}A` : null, sb.ka ? `${sb.ka}kA` : null]
      .filter(Boolean)
      .join(" · "),
    breakdown: breakdowns[i],
    ...layoutOf(sb.id),
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
