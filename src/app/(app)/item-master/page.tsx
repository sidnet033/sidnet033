import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { ItemMasterTable } from "@/components/item-master-table";
import type { ItemMaster } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ItemMasterPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";
  const { q } = await searchParams;

  const { data: items } = await supabase
    .from("item_master")
    .select("*")
    .order("item_code", { ascending: true });

  return (
    <div className="max-w-6xl space-y-4 px-8 py-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-900">Item Master</h1>
        <p className="text-sm text-slate-500">
          Every component and its cost. Feeders in the Feeder Master are built from these items.
          {isAdmin ? "" : " Only admins can edit — ask an admin to make changes."}
        </p>
      </div>
      <ItemMasterTable initialItems={(items ?? []) as ItemMaster[]} isAdmin={isAdmin} initialSearch={q ?? ""} />
    </div>
  );
}
