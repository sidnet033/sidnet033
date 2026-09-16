import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { ImportLogTable } from "@/components/import-log-table";
import type { ImportLog } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ImportLogPage() {
  const current = await getCurrentUser();
  if (current?.profile?.role !== "admin") redirect("/");

  const supabase = await createClient();
  const { data: logs } = await supabase
    .from("import_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="max-w-4xl space-y-4 px-8 py-6">
      <div>
        <Link href="/admin" className="text-xs text-secondary hover:text-primary">
          &larr; Admin Space
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-on-surface">Import Audit Log</h1>
        <p className="text-sm text-secondary">
          Every CSV/Excel upload and Google Sheet sync into the Item Master, with what changed and what failed.
        </p>
      </div>
      <ImportLogTable logs={(logs ?? []) as ImportLog[]} />
    </div>
  );
}
