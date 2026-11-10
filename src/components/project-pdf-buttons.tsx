"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import type { ProjectSummary } from "@/lib/project-summary";
import type { PdfKind } from "@/lib/project-pdf";

async function downloadPdf(summary: ProjectSummary, kind: PdfKind) {
  const { buildProjectPdf } = await import("@/lib/project-pdf");
  const { blob, filename } = await buildProjectPdf(
    { ...summary, generatedAt: new Date().toISOString() },
    kind,
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Desktop: make and download the Internal / Customer project PDF directly.
export function ProjectPdfButtons({ summary }: { summary: ProjectSummary }) {
  const [busy, setBusy] = useState<PdfKind | null>(null);

  async function download(kind: PdfKind) {
    setBusy(kind);
    try {
      await downloadPdf(summary, kind);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not make the PDF.");
    } finally {
      setBusy(null);
    }
  }

  const cls =
    "flex items-center gap-1 rounded bg-surface-container-low px-space-md py-space-sm font-label-md text-label-md text-on-surface hover:bg-surface-container disabled:opacity-50";
  return (
    <>
      <button
        type="button"
        disabled={busy != null}
        onClick={() => download("internal")}
        title="Everything incl. costs and margins, on the letterhead — for internal use only (shows the last saved data)"
        className={cls}
      >
        <Icon name="picture_as_pdf" size={16} />
        {busy === "internal" ? "Making…" : "Internal PDF"}
      </button>
      <button
        type="button"
        disabled={busy != null}
        onClick={() => download("customer")}
        title="Specs, quantities and selling prices on the letterhead — no costs or margins (shows the last saved data)"
        className={cls}
      >
        <Icon name="picture_as_pdf" size={16} />
        {busy === "customer" ? "Making…" : "Customer PDF"}
      </button>
    </>
  );
}

// Dashboard row: a small "PDF" menu; the project's data is fetched only
// when a PDF is asked for.
export function ProjectPdfMenu({ revisionId }: { revisionId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<PdfKind | null>(null);

  async function download(kind: PdfKind) {
    setBusy(kind);
    try {
      const res = await fetch(`/api/revisions/${revisionId}/summary`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load the project.");
      await downloadPdf(data as ProjectSummary, kind);
      setOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not make the PDF.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy != null}
        title="Download the project PDF (latest revision)"
        className="flex items-center gap-0.5 rounded-md border border-surface-container-high px-1.5 py-0.5 text-[12px] text-on-surface hover:bg-surface-container disabled:opacity-50"
      >
        <Icon name="picture_as_pdf" size={15} />
        {busy ? "…" : "PDF"}
        <Icon name="arrow_drop_down" size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest text-left shadow-lg">
            <button
              type="button"
              disabled={busy != null}
              onClick={() => download("internal")}
              className="block w-full px-3 py-2 text-left text-[13px] hover:bg-surface-container-low disabled:opacity-50"
            >
              {busy === "internal" ? "Making…" : "Internal PDF"}
              <span className="block text-[11px] text-secondary">
                with costs &amp; margins
              </span>
            </button>
            <button
              type="button"
              disabled={busy != null}
              onClick={() => download("customer")}
              className="block w-full border-t border-surface-container px-3 py-2 text-left text-[13px] hover:bg-surface-container-low disabled:opacity-50"
            >
              {busy === "customer" ? "Making…" : "Customer PDF"}
              <span className="block text-[11px] text-secondary">
                selling prices only
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
