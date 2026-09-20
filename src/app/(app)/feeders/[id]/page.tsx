import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { FeederBuilder } from "@/components/feeder-builder";
import { fetchAllItemMaster } from "@/lib/item-display";
import type { Feeder, FeederItemWithDetails } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function FeederDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  const [{ data: feeder }, { data: lines }, allItems] = await Promise.all([
    supabase.from("feeders").select("*").eq("id", id).single(),
    supabase.from("feeder_items").select("*, item:item_master(*)").eq("feeder_id", id).order("created_at"),
    fetchAllItemMaster(supabase),
  ]);

  if (!feeder) notFound();

  return (
    <div className="max-w-6xl px-8 py-6">
      <FeederBuilder
        feeder={feeder as Feeder}
        initialLines={(lines ?? []) as unknown as FeederItemWithDetails[]}
        allItems={allItems}
        canEdit={isAdmin || !(feeder as Feeder).is_library}
      />
    </div>
  );
}
