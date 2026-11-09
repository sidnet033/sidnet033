import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { ArtukSubpartsWorkspace } from "@/components/artuk-subparts-workspace";
import { loadRateMaster, ratesFrom } from "@/lib/enclosure-rates";
import { fetchAllRows } from "@/lib/fetch-all";
import type { ArtukPartComponent, ArtukSubpart } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ArtukSubpartsPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  const [subparts, components, master] = await Promise.all([
    fetchAllRows<ArtukSubpart>((from, to) =>
      supabase.from("artuk_subparts").select("*").order("code").range(from, to),
    ),
    fetchAllRows<ArtukPartComponent>((from, to) =>
      supabase
        .from("artuk_part_components")
        .select("*")
        .order("parent_sku")
        .order("sort_order")
        .order("id")
        .range(from, to),
    ),
    loadRateMaster(supabase),
  ]);
  const parentSkus = Array.from(new Set(components.map((c) => c.parent_sku)));
  const { data: items } = parentSkus.length
    ? await supabase
        .from("item_master")
        .select("sku, description, unit_cost, status")
        .in("sku", parentSkus)
    : { data: [] };

  return (
    <div className="max-w-[1600px] space-y-4 px-8 py-6">
      <ArtukSubpartsWorkspace
        initialSubparts={subparts}
        initialComponents={components}
        initialRates={ratesFrom(master)}
        items={
          (items ?? []) as {
            sku: string;
            description: string;
            unit_cost: number;
            status: string;
          }[]
        }
        isAdmin={isAdmin}
      />
    </div>
  );
}
