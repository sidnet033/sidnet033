"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logImport, summaryText, type ImportSummary } from "@/lib/item-import";

export function SheetSyncButton({ onDone, currentUserName }: { onDone: () => void; currentUserName?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sync-sheet", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error || "Sync failed.");
      } else {
        const summary = body as ImportSummary;
        setMessage(summaryText(summary));
        await logImport(createClient(), {
          source: "google_sheet_sync",
          summary,
          importedByName: currentUserName ?? null,
        });
        if (summary.created > 0 || summary.updated > 0) onDone();
      }
    } catch {
      setMessage("Sync failed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleSync}
        disabled={busy}
        className="flex h-8 items-center gap-1.5 rounded-[4px] bg-surface-container-low px-2.5 text-xs font-medium text-on-surface hover:bg-surface-container-high disabled:opacity-50"
      >
        {busy ? "Syncing..." : "Sync Google Sheet"}
      </button>
      {message && (
        <div className="absolute right-0 top-full z-10 mt-1 w-80 whitespace-pre-line rounded-[4px] bg-surface-container-lowest p-2 text-xs text-on-surface-variant shadow-md">
          {message}
        </div>
      )}
    </div>
  );
}
