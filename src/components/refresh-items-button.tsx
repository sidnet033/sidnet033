"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { createClient } from "@/lib/supabase/client";
import { fetchAllItemMaster } from "@/lib/item-display";
import type { ItemMaster } from "@/types/database";

// Reloads Item Master into a page that was opened a while ago (BOM Builder,
// Feeder Master) -- someone else may have added or updated items since, e.g.
// the ones a paste reported as missing. Only the item list is replaced;
// unsaved edits on the page are untouched. Says how many items are new /
// changed since the list was last loaded.
export function RefreshItemsButton({ items, onRefreshed }: { items: ItemMaster[]; onRefreshed: (fresh: ItemMaster[]) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const fresh = await fetchAllItemMaster(supabase);
      const before = new Map(items.map((i) => [i.id, i.updated_at]));
      const added = fresh.filter((i) => !before.has(i.id)).length;
      const updated = fresh.filter((i) => before.has(i.id) && before.get(i.id) !== i.updated_at).length;
      onRefreshed(fresh);
      setMessage(
        added || updated
          ? [added ? `${added} new` : null, updated ? `${updated} updated` : null].filter(Boolean).join(", ") + ` item${added + updated === 1 ? "" : "s"} loaded`
          : "No new items since you opened this page"
      );
    } catch (e) {
      setMessage(`Could not refresh items${e instanceof Error ? ` (${e.message})` : ""}`);
    } finally {
      setBusy(false);
      setTimeout(() => setMessage(null), 6000);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={refresh}
        disabled={busy}
        title="Reload Item Master — picks up items added or updated by anyone since this page was opened. Your unsaved edits stay."
        className="btn btn-outline"
      >
        <Icon name="refresh" size={16} className={busy ? "animate-spin" : undefined} /> {busy ? "Refreshing..." : "Refresh items"}
      </button>
      {message && <span className="text-xs text-on-surface-variant">{message}</span>}
    </span>
  );
}
