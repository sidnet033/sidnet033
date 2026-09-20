import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { fetchAllItemMaster } from "@/lib/item-display";
import { FeederMasterWorkspace } from "@/components/feeder-master-workspace";
import type { Feeder, FeederItemWithDetails } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FeedersPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  const [{ data: feeders }, allItems] = await Promise.all([
    supabase.from("feeders").select("*").eq("is_library", true).order("name"),
    fetchAllItemMaster(supabase),
  ]);

  const feederIds = ((feeders ?? []) as Feeder[]).map((f) => f.id);
  const { data: lines } = feederIds.length
    ? await supabase.from("feeder_items").select("*, item:item_master(*)").in("feeder_id", feederIds).order("sort_order")
    : { data: [] };

  const linesByFeeder: Record<string, FeederItemWithDetails[]> = {};
  for (const line of (lines ?? []) as unknown as FeederItemWithDetails[]) {
    (linesByFeeder[line.feeder_id] ??= []).push(line);
  }

  return (
    <FeederMasterWorkspace
      initialFeeders={(feeders ?? []) as Feeder[]}
      initialLinesByFeeder={linesByFeeder}
      allItems={allItems}
      isAdmin={isAdmin}
    />
  );
}
