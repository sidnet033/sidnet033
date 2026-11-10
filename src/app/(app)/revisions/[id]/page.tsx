import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getRevisionContext } from "@/lib/revision-context";
import { fetchAllItemMaster } from "@/lib/item-display";
import { RevisionWorkspace } from "@/components/revision-workspace";
import { buildProjectSummary } from "@/lib/project-summary";

export const dynamic = "force-dynamic";

export default async function RevisionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  const [ctx, allItems, { data: estimationHead }] = await Promise.all([
    getRevisionContext(id),
    fetchAllItemMaster(supabase),
    supabase.rpc("is_estimation_head"),
  ]);

  return (
    <Suspense fallback={null}>
      <RevisionWorkspace
        ctx={ctx}
        summary={buildProjectSummary(ctx)}
        currentUserId={current?.userId ?? ""}
        isAdmin={isAdmin}
        isEstimationHead={estimationHead === true}
        allItems={allItems}
      />
    </Suspense>
  );
}
