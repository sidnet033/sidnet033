import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/project-summary";
import { SignOutButton } from "@/components/mobile/sign-out-button";
import type { Profile } from "@/types/database";

export const dynamic = "force-dynamic";

// The signed-in user's profile (phone view): who they are, their role,
// sign-in details and log out. Passwords live in Google (sign-in is
// Google only), so "change password" links to the Google account.
export default async function MobileProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: p } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  const profile = p as Profile | null;
  const { data: roleRow } = profile?.role_id
    ? await supabase
        .from("roles")
        .select("name")
        .eq("id", profile.role_id)
        .maybeSingle()
    : { data: null };
  const meta = user.user_metadata as {
    avatar_url?: string;
    picture?: string;
    full_name?: string;
    name?: string;
  };
  const name =
    profile?.full_name || meta.full_name || meta.name || user.email || "User";
  const avatar = meta.avatar_url || meta.picture || null;
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className="space-y-3">
      <h1 className="text-[20px] font-bold">My profile</h1>

      <section className="flex items-center gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-sm">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            referrerPolicy="no-referrer"
            className="h-14 w-14 rounded-full"
          />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-[18px] font-bold text-on-primary">
            {initials}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[17px] font-bold">{name}</p>
          <p className="truncate text-[13px] text-secondary">{user.email}</p>
        </div>
      </section>

      <section className="rounded-xl bg-surface-container-lowest p-4 shadow-sm">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-[13px]">
          <Item
            k="Role"
            v={
              roleRow
                ? (roleRow as { name: string }).name
                : profile?.role === "admin"
                  ? "Admin"
                  : "Sales"
            }
          />
          <Item
            k="Status"
            v={
              profile?.disabled
                ? "Disabled"
                : profile?.status === "active"
                  ? "Active"
                  : "Invited"
            }
          />
          <Item k="Signed in with" v="Google (Pai Kane)" />
          <Item k="Last sign-in" v={fmtDateTime(user.last_sign_in_at)} />
          <Item k="Member since" v={fmtDateTime(profile?.created_at)} />
        </dl>
      </section>

      <section className="space-y-2 rounded-xl bg-surface-container-lowest p-4 shadow-sm">
        <a
          href="https://myaccount.google.com/security"
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-surface-container-high px-3 py-2.5 text-center text-[14px] font-semibold text-primary"
        >
          Change password (Google account) ↗
        </a>
        <p className="text-[11px] text-secondary">
          You sign in with your Pai Kane Google account, so your password and
          2-step verification are managed by Google, not this app.
        </p>
        <SignOutButton />
      </section>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-secondary">{k}</dt>
      <dd className="break-words font-medium">{v}</dd>
    </div>
  );
}
