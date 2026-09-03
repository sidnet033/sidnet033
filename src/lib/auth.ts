import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";

export async function getCurrentUser(): Promise<{
  userId: string;
  email: string | null;
  profile: Profile | null;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return { userId: user.id, email: user.email ?? null, profile: profile as Profile | null };
}

export async function requireAdmin() {
  const current = await getCurrentUser();
  return current?.profile?.role === "admin";
}
