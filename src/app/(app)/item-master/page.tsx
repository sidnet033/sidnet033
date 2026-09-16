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
    .order("sku", { ascending: true });

  return (
    <div className="max-w-[1600px] space-y-4 px-8 py-6">
      <ItemMasterTable
        initialItems={(items ?? []) as ItemMaster[]}
        isAdmin={isAdmin}
        initialSearch={q ?? ""}
        currentUserName={current?.profile?.full_name ?? current?.email ?? "you"}
      />
    </div>
  );
}
