import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getSwitchboardCostBreakdown } from "@/lib/switchboard-cost";
import { CostingMatrix, type SwitchboardColumn } from "@/components/costing-matrix";
import type { SiblingRevision } from "@/lib/switchboard-context";
import type { Customer, Project, Revision, Switchboard } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function RevisionCostingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  const { data: revision } = await supabase.from("revisions").select("*").eq("id", id).single();
  if (!revision) notFound();

  const { data: project } = await supabase.from("projects").select("*").eq("id", revision.project_id).single();
  if (!project) notFound();

  const [{ data: customer }, { data: lockedByProfile }, { data: siblings }, { data: switchboards }] = await Promise.all([
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
    supabase.from("switchboards").select("*").eq("revision_id", id).order("sort_order"),
  ]);

  const switchboardRows = (switchboards ?? []) as Switchboard[];
  const breakdowns = await Promise.all(switchboardRows.map((sb) => getSwitchboardCostBreakdown(supabase, sb)));

  const columns: SwitchboardColumn[] = switchboardRows.map((sb, i) => ({
    switchboard: sb,
    specSummary: [sb.form_of_separation, sb.amps ? `${sb.amps}A` : null, sb.ka ? `${sb.ka}kA` : null]
      .filter(Boolean)
      .join(" · "),
    breakdown: breakdowns[i],
  }));

  return (
    <CostingMatrix
      revision={revision as Revision}
      project={project as Project}
      customer={(customer as Customer | null) ?? null}
      columns={columns}
      currentUserId={current?.userId ?? ""}
      currentUserName={current?.profile?.full_name ?? current?.email ?? null}
      isAdmin={isAdmin}
      lockedByName={(lockedByProfile as { full_name: string | null } | null)?.full_name ?? null}
      siblingRevisions={(siblings ?? []) as SiblingRevision[]}
    />
  );
}
