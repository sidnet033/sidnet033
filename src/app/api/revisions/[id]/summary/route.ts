import { NextResponse } from "next/server";
import { getRevisionContext } from "@/lib/revision-context";
import { buildProjectSummary } from "@/lib/project-summary";

// A revision's project summary (same data as the project PDFs), for the
// dashboard's per-project PDF menu. Reads with the signed-in user's
// session, so the usual row-level security applies.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const ctx = await getRevisionContext(id);
    return NextResponse.json(buildProjectSummary(ctx));
  } catch {
    return NextResponse.json(
      { error: "Project not found or not accessible." },
      { status: 404 },
    );
  }
}
