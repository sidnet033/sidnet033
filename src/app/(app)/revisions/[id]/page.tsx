import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getRevisionContext } from "@/lib/revision-context";
import { fetchAllItemMaster } from "@/lib/item-display";
import { RevisionWorkspace } from "@/components/revision-workspace";

export const dynamic = "force-dynamic";

export default async function RevisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  const [ctx, allItems] = await Promise.all([getRevisionContext(id), fetchAllItemMaster(supabase)]);

  return (
    <Suspense fallback={null}>
      <RevisionWorkspace ctx={ctx} currentUserId={current?.userId ?? ""} isAdmin={isAdmin} allItems={allItems} />
    </Suspense>
  );
}
