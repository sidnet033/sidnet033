"use client";

import { useRef, useState } from "react";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/client";

// Expected columns in the sheet's header row (any order, case-insensitive):
// item_code, description, category, uom, unit_cost, supplier, notes
const REQUIRED_COLUMNS = ["item_code", "description"];

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

      const missing = REQUIRED_COLUMNS.filter((c) => !(c in columnIndex));
      if (missing.length > 0) {
        setMessage(`Sheet is missing required column(s): ${missing.join(", ")}`);
        setBusy(false);
        return;
      }

      const rows: {
        item_code: string;
        description: string;
        category: string | null;
        uom: string;
        unit_cost: number;
        supplier: string | null;
        notes: string | null;
      }[] = [];

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
        const itemCode = cellText("item_code").trim();
        if (!itemCode) return;

        rows.push({
          item_code: itemCode,
          description: cellText("description").trim(),
          category: cellText("category").trim() || null,
          uom: cellText("uom").trim() || "nos",
          unit_cost: Number(cellText("unit_cost")) || 0,
          supplier: cellText("supplier").trim() || null,
          notes: cellText("notes").trim() || null,
        });
      });

      if (rows.length === 0) {
        setMessage("No data rows found in the sheet.");
        setBusy(false);
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.from("item_master").upsert(rows, { onConflict: "item_code" });

      if (error) {
        setMessage(`Upload failed: ${error.message}`);
      } else {
        setMessage(`Imported ${rows.length} item(s).`);
        onDone();
      }
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
        <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-600 shadow-sm">
          {message}
        </div>
      )}
    </div>
  );
}
