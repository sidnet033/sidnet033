import { createClient } from "@/lib/supabase/server";
import { ArtukEnclosureMaster } from "@/components/artuk-enclosure-master";
import { loadRateMaster, ratesFrom } from "@/lib/enclosure-rates";
import { fetchAllRows } from "@/lib/fetch-all";
import type { ArtukPartComponent, ArtukSubpart } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ArtukEnclosureMasterPage() {
  const supabase = await createClient();
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
  // every ArTuK enclosure part in Item Master, plus any part that has a
  // sub-part breakdown (some of those aren't in Item Master yet)
  const parentSkus = Array.from(new Set(components.map((c) => c.parent_sku)));
  const [artuk, parents] = await Promise.all([
    fetchAllRows<{
      sku: string;
      description: string;
      unit_cost: number;
      status: string;
    }>((from, to) =>
      supabase
        .from("item_master")
        .select("sku, description, unit_cost, status")
        .eq("status", "active")
        .in("category", ["ArTuK Enclosure", "ARTUK"])
        .order("sku")
        .range(from, to),
    ),
    parentSkus.length
      ? supabase
          .from("item_master")
          .select("sku, description, unit_cost, status")
          .in("sku", parentSkus)
      : Promise.resolve({ data: [] }),
  ]);
  const items = [...artuk, ...((parents.data ?? []) as typeof artuk)];

  return (
    <div className="max-w-[1600px] px-8 py-6">
      <ArtukEnclosureMaster
        subparts={subparts}
        components={components}
        rates={ratesFrom(master)}
        items={
          (items ?? []) as {
            sku: string;
            description: string;
            unit_cost: number;
            status: string;
          }[]
        }
      />
    </div>
  );
}
