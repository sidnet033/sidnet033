"use client";

import { useRef, useState } from "react";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/client";
import { importItemRows, summaryText, type ParsedItemRow } from "@/lib/item-import";

// Expected columns in the sheet's header row (any order, case-insensitive):
// sku, vendor_cat, description, make, category, status, amps, ka, poles,
// uom, unit_cost, list_price, discount_pct, supplier, notes. Every row
// needs a sku or a vendor_cat (or both) plus a description — everything
// else is optional.
const REQUIRED_DESCRIPTION = "description";

export function XlsUpload({ onDone }: { onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage(null);

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
      if (!("sku" in columnIndex) && !("vendor_cat" in columnIndex)) missing.push("sku or vendor_cat");
      if (missing.length > 0) {
        setMessage(`Sheet is missing required column(s): ${missing.join(", ")}`);
        setBusy(false);
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
            status: cellText("status").trim().toLowerCase() || "active",
            amps: cellText("amps") ? Number(cellText("amps")) : null,
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
        setMessage("No data rows found in the sheet.");
        setBusy(false);
        return;
      }

      const supabase = createClient();
      const summary = await importItemRows(supabase, rows);
      setMessage(summaryText(summary));
      if (summary.created > 0 || summary.updated > 0) onDone();
    } catch {
      setMessage("Could not read that file. Make sure it's a .xlsx file.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="relative">
      <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        {busy ? "Importing..." : "Upload .xlsx"}
        <input ref={inputRef} type="file" accept=".xlsx" onChange={handleFile} disabled={busy} className="hidden" />
      </label>
      {message && (
        <div className="absolute right-0 top-full z-10 mt-1 w-80 whitespace-pre-line rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-600 shadow-sm">
          {message}
        </div>
      )}
    </div>
  );
}
