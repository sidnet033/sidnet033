"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="w-full rounded-lg bg-error px-3 py-2.5 text-[14px] font-semibold text-on-error disabled:opacity-50"
    >
      {busy ? "Logging out…" : "Log out"}
    </button>
  );
}
