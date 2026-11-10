import { createClient } from "@/lib/supabase/server";
import {
  MobileProjectList,
  type MobileProjectRow,
} from "@/components/mobile/mobile-project-list";
import type { Project, ProjectStage } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function MobileProjectsPage() {
  const supabase = await createClient();
  const [{ data: customers }, { data: projects }, { data: revisions }] =
    await Promise.all([
      supabase.from("customers").select("id, name"),
      supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("revisions")
        .select("id, project_id, revision_number, archived, updated_at"),
    ]);
  const customerName = new Map(
    ((customers ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ]),
  );
  type Rev = {
    id: string;
    project_id: string;
    revision_number: number;
    archived: boolean;
    updated_at: string;
  };
  const latest = new Map<string, Rev>();
  for (const r of (revisions ?? []) as Rev[]) {
    const cur = latest.get(r.project_id);
    if (!cur || r.revision_number > cur.revision_number)
      latest.set(r.project_id, r);
  }
  const rows: MobileProjectRow[] = ((projects ?? []) as Project[])
    .filter((p) => latest.has(p.id))
    .map((p) => {
      const r = latest.get(p.id)!;
      return {
        projectId: p.id,
        revisionId: r.id,
        revisionNumber: r.revision_number,
        archived: r.archived,
        updatedAt: r.updated_at,
        code: p.code,
        title: p.title,
        customer: p.customer_id
          ? (customerName.get(p.customer_id) ?? null)
          : null,
        stage: p.stage as ProjectStage,
        crm: p.crm_enquiry_number,
        site: p.site_country,
        quoteRequiredBy: p.quote_required_by,
      };
    });
  return <MobileProjectList rows={rows} />;
}
