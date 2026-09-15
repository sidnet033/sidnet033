import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Customer, Project, Revision, Switchboard } from "@/types/database";

export type SiblingRevision = { id: string; revision_number: number; status: string };
export type SiblingSwitchboard = { id: string; tag: string; title: string | null };

export type SwitchboardContext = {
  switchboard: Switchboard;
  revision: Revision;
  project: Project;
  customer: Customer | null;
  siblingRevisions: SiblingRevision[];
  siblingSwitchboards: SiblingSwitchboard[];
  lockedByName: string | null;
};

// Shared by the Summary / BOM Builder / GA Builder tab pages: one round
// trip to resolve a switchboard's full breadcrumb (project/revision/
// customer) plus the sibling data the lock controls and switchboard
// picker need.
export async function getSwitchboardContext(switchboardId: string): Promise<SwitchboardContext> {
  const supabase = await createClient();

  const { data: switchboard } = await supabase.from("switchboards").select("*").eq("id", switchboardId).single();
  if (!switchboard) notFound();

  const { data: revision } = await supabase.from("revisions").select("*").eq("id", switchboard.revision_id).single();
  if (!revision) notFound();

  const { data: project } = await supabase.from("projects").select("*").eq("id", revision.project_id).single();
  if (!project) notFound();

  const [{ data: customer }, { data: lockedByProfile }, { data: siblingRevisions }, { data: siblingSwitchboards }] =
    await Promise.all([
      project.customer_id
        ? supabase.from("customers").select("*").eq("id", project.customer_id).single()
        : Promise.resolve({ data: null }),
      revision.locked_by
        ? supabase.from("profiles").select("full_name").eq("id", revision.locked_by).single()
        : Promise.resolve({ data: null }),
      supabase
        .from("revisions")
        .select("id, revision_number, status")
        .eq("revision_group_id", revision.revision_group_id)
        .order("revision_number"),
      supabase.from("switchboards").select("id, tag, title").eq("revision_id", revision.id).order("sort_order"),
    ]);

  return {
    switchboard: switchboard as Switchboard,
    revision: revision as Revision,
    project: project as Project,
    customer: (customer as Customer | null) ?? null,
    siblingRevisions: (siblingRevisions ?? []) as SiblingRevision[],
    siblingSwitchboards: (siblingSwitchboards ?? []) as SiblingSwitchboard[],
    lockedByName: (lockedByProfile as { full_name: string | null } | null)?.full_name ?? null,
  };
}
