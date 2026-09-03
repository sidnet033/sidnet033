import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { ItemMasterTable } from "@/components/item-master-table";
import type { ItemMaster } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ItemMasterPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  const { data: items } = await supabase
    .from("item_master")
    .select("*")
    .order("item_code", { ascending: true });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Item Master</h1>
        <p className="text-sm text-slate-500">
          Every component and its cost. Feeders in the Feeder Library are built from these items.
          {isAdmin ? "" : " Only admins can edit — ask an admin to make changes."}
        </p>
      </div>
      <ItemMasterTable initialItems={(items ?? []) as ItemMaster[]} isAdmin={isAdmin} />
    </div>
  );
}
