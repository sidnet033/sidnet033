import { getRevisionContext } from "@/lib/revision-context";
import { buildProjectSummary } from "@/lib/project-summary";
import { MobileProjectSummary } from "@/components/mobile/mobile-project-summary";

export const dynamic = "force-dynamic";

export default async function MobileRevisionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getRevisionContext(id);
  return <MobileProjectSummary summary={buildProjectSummary(ctx)} />;
}
