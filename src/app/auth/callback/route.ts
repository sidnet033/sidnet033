import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth-policy";

// Google OAuth lands here: swap the code for a session, then allow only
// invited, enabled @paikane.com users.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));

  // Supabase sends errors back as query params (e.g. the new-user block)
  const oauthError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (oauthError)
    return fail(
      /database error saving new user/i.test(oauthError)
        ? "not_invited"
        : "failed",
    );
  if (!code) return fail("failed");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail("failed");

  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    return fail("domain");
  }
  // accounts exist only through an admin invite
  if (!data.user.invited_at) {
    await supabase.auth.signOut();
    return fail("not_invited");
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("disabled")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile) {
    await supabase.auth.signOut();
    return fail("not_invited");
  }
  if ((profile as { disabled: boolean | null }).disabled) {
    await supabase.auth.signOut();
    return fail("disabled");
  }
  // first sign-in after an invite: show the user as active
  await supabase.rpc("accept_invite");
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
