import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getSwitchboardContext } from "@/lib/switchboard-context";
import { BomBuilder } from "@/components/bom-builder";
import type {
  Feeder,
  FeederItemWithDetails,
  ItemMaster,
  SwitchboardBusbarLine,
  SwitchboardEnclosureLine,
} from "@/types/database";

export const dynamic = "force-dynamic";

export type FeederPlacement = { id: string; vertical_id: string; tier_number: number; qty: number };
export type FeederModule = {
  feeder: Feeder;
  placements: FeederPlacement[];
  placementQty: number;
  lines: FeederItemWithDetails[];
};
export type LibraryFeederOption = { id: string; name: string; category: string | null; tag: string | null; rating_summary: string | null };

export default async function BomBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  const ctx = await getSwitchboardContext(id);

  const { data: verticals } = await supabase.from("verticals").select("id").eq("switchboard_id", id);
  const verticalIds = ((verticals ?? []) as { id: string }[]).map((v) => v.id);

  const [{ data: placed }, { data: allItems }, { data: busbars }, { data: enclosureLines }, { data: libraryFeeders }] =
    await Promise.all([
      verticalIds.length
        ? supabase
            .from("placed_feeders")
            .select("id, vertical_id, tier_number, qty, feeder:feeders(*)")
            .in("vertical_id", verticalIds)
        : Promise.resolve({ data: [] }),
      supabase.from("item_master").select("*").order("sku"),
      supabase.from("switchboard_busbars").select("*").eq("switchboard_id", id).order("sort_order"),
      supabase.from("switchboard_enclosure_lines").select("*").eq("switchboard_id", id).order("sort_order"),
      supabase.from("feeders").select("id, name, category, tag, rating_summary").eq("is_library", true).order("name"),
    ]);

  type PlacedRow = FeederPlacement & { feeder: Feeder };
  const placedRows = (placed ?? []) as unknown as PlacedRow[];

  const feederById = new Map<string, Feeder>();
  const placementsByFeeder = new Map<string, FeederPlacement[]>();
  for (const p of placedRows) {
    feederById.set(p.feeder.id, p.feeder);
    const list = placementsByFeeder.get(p.feeder.id) ?? [];
    list.push({ id: p.id, vertical_id: p.vertical_id, tier_number: p.tier_number, qty: p.qty });
    placementsByFeeder.set(p.feeder.id, list);
  }

  const feederIds = Array.from(feederById.keys());
  const { data: feederLines } = feederIds.length
    ? await supabase.from("feeder_items").select("*, item:item_master(*)").in("feeder_id", feederIds).order("created_at")
    : { data: [] };

  const linesByFeeder = new Map<string, FeederItemWithDetails[]>();
  for (const line of (feederLines ?? []) as unknown as FeederItemWithDetails[]) {
    const list = linesByFeeder.get(line.feeder_id) ?? [];
    list.push(line);
    linesByFeeder.set(line.feeder_id, list);
  }

  const modules: FeederModule[] = feederIds.map((fid) => {
    const placements = placementsByFeeder.get(fid) ?? [];
    return {
      feeder: feederById.get(fid)!,
      placements,
      placementQty: placements.reduce((s, p) => s + p.qty, 0),
      lines: linesByFeeder.get(fid) ?? [],
    };
  });

  const placedFeederIds = new Set(feederIds);
  const libraryFeederOptions = ((libraryFeeders ?? []) as LibraryFeederOption[]).filter(
    (f) => !placedFeederIds.has(f.id)
  );

  return (
    <BomBuilder
      ctx={ctx}
      currentUserId={current?.userId ?? ""}
      currentUserName={current?.profile?.full_name ?? current?.email ?? null}
      isAdmin={isAdmin}
      initialModules={modules}
      allItems={(allItems ?? []) as ItemMaster[]}
      initialBusbars={(busbars ?? []) as SwitchboardBusbarLine[]}
      initialEnclosureLines={(enclosureLines ?? []) as SwitchboardEnclosureLine[]}
      libraryFeederOptions={libraryFeederOptions}
    />
  );
}
