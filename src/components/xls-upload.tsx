"use client";

import { useRef, useState } from "react";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/client";
import { importItemRows, logImport, type ImportSummary, type ParsedItemRow } from "@/lib/item-import";
import { Icon } from "@/components/icon";

// Expected columns in the sheet's header row (any order, case-insensitive):
// sku, vendor_cat, description, make, category, source, status, amps,
// frame, ka, poles, uom, unit_cost, list_price, discount_pct, supplier,
// notes. Every row needs a sku or a vendor_cat (or both), a description,
// and a Source (Design or Estimation) — everything else is optional.
// frame only means anything for ACB/MCCB/MCB items, but it's a plain
// optional column like the rest.
const REQUIRED_DESCRIPTION = "description";
const REQUIRED_SOURCE = "source";

type Stage = "idle" | "reading" | "importing" | "done" | "error";

export function XlsUpload({ onDone, currentUserName }: { onDone: () => void; currentUserName?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setStage("reading");
    setSummary(null);
    setErrorText(null);
    setProgress({ done: 0, total: 0 });

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];

      const headerRow = sheet.getRow(1);
      const columnIndex: Record<string, number> = {};
      headerRow.eachCell((cell, colNumber) => {
        const key = String(cell.value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
        if (key) columnIndex[key] = colNumber;
      });

      const missing: string[] = [];
      if (!(REQUIRED_DESCRIPTION in columnIndex)) missing.push("description");
      if (!(REQUIRED_SOURCE in columnIndex)) missing.push("source");
      if (!("sku" in columnIndex) && !("vendor_cat" in columnIndex)) missing.push("sku or vendor_cat");
      if (missing.length > 0) {
        setErrorText(`Sheet is missing required column(s): ${missing.join(", ")}`);
        setStage("error");
        return;
      }

      const rows: { rowNumber: number; data: ParsedItemRow }[] = [];

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const cellText = (key: string) => {
          const idx = columnIndex[key];
          if (!idx) return "";
          const v = row.getCell(idx).value;
          if (v == null) return "";
          if (typeof v === "object" && "text" in v) return String((v as { text: string }).text);
          return String(v);
        };
        if (row.cellCount === 0) return;

        rows.push({
          rowNumber,
          data: {
            sku: cellText("sku").trim() || null,
            vendor_cat: cellText("vendor_cat").trim() || null,
            description: cellText("description").trim(),
            make: cellText("make").trim() || null,
            category: cellText("category").trim() || null,
            source: cellText("source").trim(),
            status: cellText("status").trim().toLowerCase() || "active",
            amps: cellText("amps") ? Number(cellText("amps")) : null,
            frame: cellText("frame").trim() || null,
            ka: cellText("ka") ? Number(cellText("ka")) : null,
            poles: cellText("poles") ? Number(cellText("poles")) : null,
            uom: cellText("uom").trim() || "nos",
            unit_cost: Number(cellText("unit_cost")) || 0,
            list_price: cellText("list_price") ? Number(cellText("list_price")) : null,
            discount_pct: cellText("discount_pct") ? Number(cellText("discount_pct")) : null,
            supplier: cellText("supplier").trim() || null,
            notes: cellText("notes").trim() || null,
          },
        });
      });

      if (rows.length === 0) {
        setErrorText("No data rows found in the sheet.");
        setStage("error");
        return;
      }

      setStage("importing");
      setProgress({ done: 0, total: rows.length });

      const supabase = createClient();
      const result = await importItemRows(supabase, rows, (done, total) => setProgress({ done, total }));
      await logImport(supabase, {
        source: "xlsx_upload",
        fileName: file.name,
        summary: result,
        importedByName: currentUserName ?? null,
      });
      setSummary(result);
      setStage("done");
      if (result.created > 0 || result.updated > 0) onDone();
    } catch {
      setErrorText("Could not read that file. Make sure it's a .xlsx file.");
      setStage("error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function close() {
    setStage("idle");
    setSummary(null);
    setErrorText(null);
  }

  const open = stage !== "idle";
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[4px] bg-surface-container-lowest px-2.5 text-xs font-medium text-on-surface shadow-sm hover:bg-surface-container-low">
        <Icon name="upload_file" size={16} className="text-secondary" /> Import CSV / Excel
        <input ref={inputRef} type="file" accept=".xlsx" onChange={handleFile} disabled={open} className="hidden" />
      </label>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[8px] bg-surface-container-lowest p-5 shadow-md">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary-container text-on-primary-container">
                <Icon name="upload_file" size={20} />
              </div>
              <div>
                <h2 className="font-display text-sm font-semibold text-on-surface">Import item master</h2>
                <p className="text-xs text-secondary">{fileName}</p>
              </div>
            </div>

            {(stage === "reading" || stage === "importing") && (
              <div className="space-y-2">
                <p className="text-xs text-on-surface-variant">
                  {stage === "reading" ? "Reading file..." : `Importing row ${progress.done} of ${progress.total}...`}
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: stage === "reading" ? "15%" : `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {stage === "error" && (
              <div className="space-y-3">
                <p className="text-sm text-error">{errorText}</p>
                <button
                  onClick={close}
                  className="rounded-[4px] bg-surface-container-low px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-container-high"
                >
                  Close
                </button>
              </div>
            )}

            {stage === "done" && summary && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-[4px] bg-tertiary-fixed/50 p-2">
                    <p className="font-display text-lg font-bold text-on-tertiary-fixed">{summary.created}</p>
                    <p className="text-[10px] uppercase tracking-wide text-on-tertiary-fixed/80">New</p>
                  </div>
                  <div className="rounded-[4px] bg-secondary-container/60 p-2">
                    <p className="font-display text-lg font-bold text-on-secondary-container">{summary.updated}</p>
                    <p className="text-[10px] uppercase tracking-wide text-on-secondary-container/80">Updated</p>
                  </div>
                  <div className="rounded-[4px] bg-error-container p-2">
                    <p className="font-display text-lg font-bold text-on-error-container">{summary.skipped.length}</p>
                    <p className="text-[10px] uppercase tracking-wide text-on-error-container/80">Failed</p>
                  </div>
                </div>

                {summary.skipped.length > 0 && (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-[4px] bg-surface-container-low p-2">
                    {summary.skipped.map((s, i) => (
                      <p key={i} className="text-[11px] text-on-surface-variant">
                        <span className="font-medium text-error">Row {s.row}:</span> {s.reason}
                      </p>
                    ))}
                  </div>
                )}

                <p className="text-[11px] text-secondary">Saved to the import audit log.</p>

                <button
                  onClick={close}
                  className="w-full rounded-[4px] bg-primary py-1.5 text-xs font-medium text-on-primary hover:bg-primary-container"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
