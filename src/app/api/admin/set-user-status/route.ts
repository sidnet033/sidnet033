import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

// Suspends or restores a user's ability to sign in, via Supabase Auth's
// admin ban API -- this is real enforcement (a banned user can't get a
// new session), not just a cosmetic flag. profiles.disabled is updated
// in the same call so the UI reflects it immediately.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await requireAdmin())) {
    return NextResponse.json({ error: "Only admins can change account access." }, { status: 403 });
  }

  const { userId, disabled } = (await request.json()) as { userId?: string; disabled?: boolean };
  if (!userId || typeof disabled !== "boolean") {
    return NextResponse.json({ error: "userId and disabled are required." }, { status: 400 });
  }
  if (userId === user.id) {
    return NextResponse.json({ error: "You can't disable your own account." }, { status: 400 });
  }

  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY isn't configured yet -- add it in your Vercel project's environment variables (from Supabase Settings -> API -> service_role secret) to enable disabling users." },
      { status: 400 }
    );
  }

  const admin = createServiceClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: disabled ? "876000h" : "none",
  });
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const { error: profileError } = await admin.from("profiles").update({ disabled }).eq("id", userId);
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
