"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Who has a switchboard open right now. The revision workspace heartbeats a
// row while a switchboard is selected; anything seen within ONLINE_WINDOW_MS
// counts as open. Rows from a closed tab simply age out.
const HEARTBEAT_MS = 30_000;
const ONLINE_WINDOW_MS = 90_000;
const POLL_MS = 20_000;

export function useSwitchboardHeartbeat(switchboardId: string | null) {
  useEffect(() => {
    if (!switchboardId) return;
    const supabase = createClient();
    let userId: string | null = null;
    let stopped = false;

    const beat = async () => {
      // background tabs keep beating too: an open tab -- maybe holding
      // unsaved work -- keeps its switchboard lock alive
      if (stopped) return;
      if (!userId)
        userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      if (!userId || stopped) return;
      await supabase
        .from("switchboard_presence")
        .upsert({
          switchboard_id: switchboardId,
          user_id: userId,
          last_seen_at: new Date().toISOString(),
        });
    };
    const clear = () => {
      if (userId)
        void supabase
          .from("switchboard_presence")
          .delete()
          .eq("switchboard_id", switchboardId)
          .eq("user_id", userId);
    };

    void beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => void beat();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", clear);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", clear);
      clear();
    };
  }, [switchboardId]);
}

/** switchboard id -> names of people who have it open right now */
export function useOnlineSwitchboards(): Map<string, string[]> {
  const [online, setOnline] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    const load = async () => {
      const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
      const { data: rows } = await supabase
        .from("switchboard_presence")
        .select("switchboard_id, user_id")
        .gte("last_seen_at", since);
      const ids = [...new Set((rows ?? []).map((r) => r.user_id as string))];
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("id, full_name").in("id", ids)
        : { data: [] as { id: string; full_name: string | null }[] };
      const names = new Map(
        (profiles ?? []).map((p) => [
          p.id as string,
          (p.full_name as string | null) ?? "A user",
        ]),
      );
      const next = new Map<string, string[]>();
      for (const r of rows ?? []) {
        const list = next.get(r.switchboard_id as string) ?? [];
        list.push(names.get(r.user_id as string) ?? "A user");
        next.set(r.switchboard_id as string, list);
      }
      if (!cancelled) setOnline(next);
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return online;
}

/** browser "leave site? changes may not be saved" prompt while there's unsaved work */
export function useWarnOnUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
