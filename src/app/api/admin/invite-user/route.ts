import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

// Invites a new user by email (Supabase sends the invite email itself).
// This is the one admin action that needs the service-role key -- every
// other admin action in this app (reset password, role changes) works
// with the normal authenticated client under RLS.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await requireAdmin())) {
    return NextResponse.json({ error: "Only admins can invite users." }, { status: 403 });
  }

  const { email, fullName } = (await request.json()) as { email?: string; fullName?: string };
  if (!email || !email.trim()) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY isn't configured yet -- add it in your Vercel project's environment variables (from Supabase Settings -> API -> service_role secret) to enable inviting users." },
      { status: 400 }
    );
  }

  const admin = createServiceClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const redirectTo = `${new URL(request.url).origin}/set-password`;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email.trim(), {
    data: { full_name: fullName?.trim() || undefined },
    redirectTo,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ userId: data.user.id });
}
