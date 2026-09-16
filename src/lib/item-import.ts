import type { SupabaseClient } from "@supabase/supabase-js";

// Shared between the .xlsx upload (browser) and the Google Sheet sync
// (server) — both parse rows into this shape, then hand off to
// importItemRows for the actual create-or-update logic.
export type ParsedItemRow = {
  sku: string | null;
  vendor_cat: string | null;
  description: string;
  make: string | null;
  category: string | null;
  status: string;
  amps: number | null;
  ka: number | null;
  poles: number | null;
  uom: string;
  unit_cost: number;
  list_price: number | null;
  discount_pct: number | null;
  supplier: string | null;
  notes: string | null;
};

export type ImportSummary = {
  created: number;
  updated: number;
  skipped: { row: number; reason: string }[];
};

// Every item needs a SKU or a Vendor Cat (or both) — this is the key used
// to decide whether an incoming row updates an existing item or creates a
// new one: match by SKU first, then by Vendor Cat.
export async function importItemRows(
  supabase: SupabaseClient,
  rows: { rowNumber: number; data: ParsedItemRow }[],
  onProgress?: (done: number, total: number) => void
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, skipped: [] };
  let done = 0;

  for (const { rowNumber, data } of rows) {
    if (!data.sku && !data.vendor_cat) {
      summary.skipped.push({ row: rowNumber, reason: "Missing both SKU and Vendor Cat" });
      done += 1;
      onProgress?.(done, rows.length);
      continue;
    }
    if (!data.description) {
      summary.skipped.push({ row: rowNumber, reason: "Missing description" });
      done += 1;
      onProgress?.(done, rows.length);
      continue;
    }

    let existingId: string | null = null;
    if (data.sku) {
      const { data: bySku } = await supabase
        .from("item_master")
        .select("id")
        .eq("sku", data.sku)
        .maybeSingle();
      existingId = (bySku as { id: string } | null)?.id ?? null;
    }
    if (!existingId && data.vendor_cat) {
      const { data: byVendorCat } = await supabase
        .from("item_master")
        .select("id")
        .eq("vendor_cat", data.vendor_cat)
        .maybeSingle();
      existingId = (byVendorCat as { id: string } | null)?.id ?? null;
    }

    if (existingId) {
      const { error } = await supabase
        .from("item_master")
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq("id", existingId);
      if (error) {
        summary.skipped.push({ row: rowNumber, reason: error.message });
        done += 1;
        onProgress?.(done, rows.length);
        continue;
      }
      summary.updated += 1;
    } else {
      const { error } = await supabase.from("item_master").insert(data);
      if (error) {
        summary.skipped.push({ row: rowNumber, reason: error.message });
        done += 1;
        onProgress?.(done, rows.length);
        continue;
      }
      summary.created += 1;
    }
    done += 1;
    onProgress?.(done, rows.length);
  }

  return summary;
}

// Records an import run in import_logs so it shows up in the audit log,
// regardless of which entry point (xlsx upload or Google Sheet sync) ran it.
export async function logImport(
  supabase: SupabaseClient,
  params: {
    source: "xlsx_upload" | "google_sheet_sync";
    fileName?: string | null;
    summary: ImportSummary;
    importedByName?: string | null;
  }
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("import_logs").insert({
    source: params.source,
    file_name: params.fileName ?? null,
    created_count: params.summary.created,
    updated_count: params.summary.updated,
    failed_count: params.summary.skipped.length,
    failures: params.summary.skipped,
    imported_by: user?.id ?? null,
    imported_by_name: params.importedByName ?? null,
  });
}

export function summaryText(summary: ImportSummary): string {
  const parts = [`${summary.created} created`, `${summary.updated} updated`];
  if (summary.skipped.length > 0) parts.push(`${summary.skipped.length} skipped`);
  let text = parts.join(", ") + ".";
  if (summary.skipped.length > 0) {
    const shown = summary.skipped.slice(0, 5);
    text += "\n" + shown.map((s) => `Row ${s.row}: ${s.reason}`).join("\n");
    if (summary.skipped.length > shown.length) {
      text += `\n…and ${summary.skipped.length - shown.length} more`;
    }
  }
  return text;
}
