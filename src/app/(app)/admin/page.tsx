import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { AdminUserTable } from "@/components/admin-user-table";
import { Icon } from "@/components/icon";
import type { Profile } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminSpacePage() {
  const current = await getCurrentUser();
  if (current?.profile?.role !== "admin") redirect("/");

  const supabase = await createClient();
  const { data: profiles } = await supabase.from("profiles").select("*").order("created_at");

  return (
    <div className="max-w-4xl space-y-4 px-8 py-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-on-surface">Admin Space</h1>
        <p className="text-sm text-secondary">
          Manage who on your team can edit the item master and feeder master.
        </p>
      </div>
      <AdminUserTable initialProfiles={(profiles ?? []) as Profile[]} currentUserId={current.userId} />

      <Link
        href="/admin/import-log"
        className="flex items-center justify-between rounded-[8px] bg-surface-container-lowest p-4 shadow-sm hover:bg-surface-container-low"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary-container text-on-primary-container">
            <Icon name="history" size={20} />
          </div>
          <div>
            <p className="text-sm font-medium text-on-surface">Import Audit Log</p>
            <p className="text-xs text-secondary">Every CSV/Excel upload and Google Sheet sync, with what changed and what failed.</p>
          </div>
        </div>
        <Icon name="chevron_right" size={18} className="text-secondary" />
      </Link>
    </div>
  );
}
