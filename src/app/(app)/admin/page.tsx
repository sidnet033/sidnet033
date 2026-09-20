import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { AdminSpaceShell } from "@/components/admin/admin-space-shell";
import type { Profile, Role, RolePermission } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminSpacePage() {
  const current = await getCurrentUser();
  if (current?.profile?.role !== "admin") redirect("/");

  const supabase = await createClient();
  const [{ data: profiles }, { data: roles }, { data: rolePermissions }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("roles").select("*").order("created_at"),
    supabase.from("role_permissions").select("*"),
  ]);

  return (
    <AdminSpaceShell
      initialProfiles={(profiles ?? []) as Profile[]}
      initialRoles={(roles ?? []) as Role[]}
      initialPermissions={(rolePermissions ?? []) as RolePermission[]}
      currentUserId={current.userId}
    />
  );
}
