import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFeederCosts } from "@/lib/feeder-cost";
import { GaCanvas } from "@/components/ga-canvas";
import type { Feeder, PlacedFeeder, Project, Vertical } from "@/types/database";

export const dynamic = "force-dynamic";

export type VerticalWithFeeders = Vertical & {
  placed: (PlacedFeeder & { feeder: Feeder & { cost: number } })[];
};

export default async function GaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: verticals }, { data: feeders }, feederCosts] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("verticals").select("*").eq("project_id", id).order("sort_order"),
    supabase.from("feeders").select("*").order("name"),
    getFeederCosts(await createClient()),
  ]);

  if (!project) notFound();

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
    <GaCanvas project={project as Project} initialVerticals={verticalsWithFeeders} feederLibrary={feederLibrary} />
  );
}
