import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { AdminUserTable } from "@/components/admin-user-table";
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
        <h1 className="font-display text-xl font-semibold text-slate-900">Admin Space</h1>
        <p className="text-sm text-slate-500">
          Manage who on your team can edit the item master and feeder master.
        </p>
      </div>
      <AdminUserTable initialProfiles={(profiles ?? []) as Profile[]} currentUserId={current.userId} />
    </div>
  );
}
