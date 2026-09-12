"use client";

import { useState } from "react";
import { summaryText, type ImportSummary } from "@/lib/item-import";

export function SheetSyncButton({ onDone }: { onDone: () => void }) {
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
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? "Syncing..." : "Sync Google Sheet"}
      </button>
      {message && (
        <div className="absolute right-0 top-full z-10 mt-1 w-80 whitespace-pre-line rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-600 shadow-sm">
          {message}
        </div>
      )}
    </div>
  );
}
