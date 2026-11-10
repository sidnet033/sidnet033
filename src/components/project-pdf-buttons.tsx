"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import type { ProjectSummary } from "@/lib/project-summary";
import type { PdfKind } from "@/lib/project-pdf";

// Desktop: make and download the Internal / Customer project PDF directly.
export function ProjectPdfButtons({ summary }: { summary: ProjectSummary }) {
  const [busy, setBusy] = useState<PdfKind | null>(null);

  async function download(kind: PdfKind) {
    setBusy(kind);
    try {
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
