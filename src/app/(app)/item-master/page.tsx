import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { ItemMasterTable } from "@/components/item-master-table";
import { fetchAllItemMaster } from "@/lib/item-display";

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

  const items = await fetchAllItemMaster(supabase);

  return (
    <div className="max-w-[1600px] space-y-4 px-8 py-6">
      <ItemMasterTable
        initialItems={items}
        isAdmin={isAdmin}
        initialSearch={q ?? ""}
        currentUserName={current?.profile?.full_name ?? current?.email ?? "you"}
      />
    </div>
  );
}
