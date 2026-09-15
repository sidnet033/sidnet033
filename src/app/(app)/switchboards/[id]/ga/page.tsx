import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getSwitchboardContext } from "@/lib/switchboard-context";
import { getFeederCosts } from "@/lib/feeder-cost";
import { getSwitchboardCostBreakdown } from "@/lib/switchboard-cost";
import { GaCanvas } from "@/components/ga-canvas";
import type { Feeder, ItemMaster, PlacedFeeder, Vertical } from "@/types/database";

export const dynamic = "force-dynamic";

export type VerticalWithFeeders = Vertical & {
  placed: (PlacedFeeder & { feeder: Feeder & { cost: number } })[];
};

export default async function GaBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  const ctx = await getSwitchboardContext(id);

  const [{ data: verticals }, { data: feeders }, { data: allItems }, feederCosts, breakdown] = await Promise.all([
    supabase.from("verticals").select("*").eq("switchboard_id", id).order("sort_order"),
    supabase.from("feeders").select("*").or(`is_library.eq.true,switchboard_id.eq.${id}`).order("name"),
    supabase.from("item_master").select("*").order("sku"),
    getFeederCosts(await createClient()),
    getSwitchboardCostBreakdown(await createClient(), ctx.switchboard),
  ]);

  const verticalIds = (verticals ?? []).map((v) => v.id);
  const { data: placed } = verticalIds.length
    ? await supabase
        .from("placed_feeders")
        .select("*, feeder:feeders(*)")
        .in("vertical_id", verticalIds)
        .order("sort_order")
    : { data: [] };

  const verticalsWithFeeders: VerticalWithFeeders[] = (verticals ?? []).map((v) => ({
    ...v,
    placed: ((placed ?? []) as unknown as (PlacedFeeder & { feeder: Feeder; vertical_id: string })[])
      .filter((p) => p.vertical_id === v.id)
      .map((p) => ({ ...p, feeder: { ...p.feeder, cost: feederCosts.get(p.feeder.id) ?? 0 } })),
  }));

  const feederLibrary = ((feeders ?? []) as Feeder[]).map((f) => ({
    ...f,
    cost: feederCosts.get(f.id) ?? 0,
  }));

  return (
    <GaCanvas
      ctx={ctx}
      initialVerticals={verticalsWithFeeders}
      feederLibrary={feederLibrary}
      allItems={(allItems ?? []) as ItemMaster[]}
      currentUserId={current?.userId ?? ""}
      currentUserName={current?.profile?.full_name ?? current?.email ?? null}
      isAdmin={isAdmin}
      enclosureCost={breakdown.enclosure}
    />
  );
}
