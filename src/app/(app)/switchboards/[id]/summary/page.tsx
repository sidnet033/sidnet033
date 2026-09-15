import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getSwitchboardContext } from "@/lib/switchboard-context";
import { getSwitchboardCostBreakdown } from "@/lib/switchboard-cost";
import { SwitchboardSummaryView } from "@/components/switchboard-summary-view";

export const dynamic = "force-dynamic";

export default async function SwitchboardSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current?.profile?.role === "admin";

  const ctx = await getSwitchboardContext(id);
  const breakdown = await getSwitchboardCostBreakdown(supabase, ctx.switchboard);

  const [{ count: bayCount }, { count: feederCount }] = await Promise.all([
    supabase
      .from("verticals")
      .select("*", { count: "exact", head: true })
      .eq("switchboard_id", id)
      .or("bay_type.is.null,bay_type.neq.unassigned"),
    supabase
      .from("placed_feeders")
      .select("*, vertical:verticals!inner(switchboard_id)", { count: "exact", head: true })
      .eq("vertical.switchboard_id", id),
  ]);

  return (
    <SwitchboardSummaryView
      ctx={ctx}
      currentUserId={current?.userId ?? ""}
      currentUserName={current?.profile?.full_name ?? current?.email ?? null}
      isAdmin={isAdmin}
      breakdown={breakdown}
      bayCount={bayCount ?? 0}
      feederCount={feederCount ?? 0}
    />
  );
}
