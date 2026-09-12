"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function NewFeederButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("feeders")
      .insert({ name: "New feeder", created_by: user?.id })
      .select("id")
      .single();

    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    router.push(`/feeders/${data.id}`);
  }

  return (
    <button
      onClick={handleCreate}
      disabled={busy}
      className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
    >
      + New feeder
    </button>
  );
}
