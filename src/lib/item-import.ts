import type { SupabaseClient } from "@supabase/supabase-js";
import { validateNewItemFields } from "@/lib/item-display";
import { effectiveNetRate } from "@/lib/feeder-cost";

// Shared between the .xlsx upload (browser) and the Google Sheet sync
// (server) — both parse rows into this shape, then hand off to
// importItemRows for the actual create-or-update logic.
export type ParsedItemRow = {
  sku: string | null;
  vendor_cat: string | null;
  description: string;
  make: string | null;
  category: string | null;
  source: string;
  status: string;
  amps: number | null;
  frame: string | null;
  ka: number | null;
  poles: number | null;
  uom: string;
  unit_cost: number;
  list_price: number | null;
  discount_pct: number | null;
  supplier: string | null;
  notes: string | null;
  pricelisted: boolean;
  mrp_or_lp: "MRP" | "LP" | null;
  hsn_code: string | null;
  vendor_description: string | null;
};

// Shared true/false parsing for the "pricelisted" column in both the .xlsx
// upload and the Google Sheet sync -- accepts the common spellings someone
// would actually type in a spreadsheet cell.
export function parseBooleanCell(v: string): boolean {
  return ["yes", "y", "true", "1"].includes(v.trim().toLowerCase());
}

// mrp_or_lp only ever holds one of two values -- anything else typed in
// the cell (blank, a typo, a stray price) is treated as not set rather
// than rejecting the whole row over one optional column.
export function parseMrpOrLpCell(v: string): "MRP" | "LP" | null {
  const normalized = v.trim().toUpperCase();
  return normalized === "MRP" || normalized === "LP" ? normalized : null;
}

export type ImportSummary = {
  created: number;
  updated: number;
  skipped: { row: number; reason: string }[];
};

const CHUNK_SIZE = 500;

type Resolved = { rowNumber: number; id: string; data: ParsedItemRow; isNew: boolean };

// Every item needs a SKU or a Vendor Cat (or both) — this is the key used
// to decide whether an incoming row updates an existing item or creates a
// new one: match by SKU first, then by Vendor Cat.
//
// This resolves every row's target id in one pass against a single
// up-front fetch of the existing catalog (instead of 1-2 lookup queries
// per row), then writes in large chunked insert/upsert batches rather
// than one round trip per row — the row-by-row version took ~1 row/sec
// over the network, which made a 3000-row import take the better part
// of an hour.
export async function importItemRows(
  supabase: SupabaseClient,
  rows: { rowNumber: number; data: ParsedItemRow }[],
  onProgress?: (done: number, total: number) => void
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, skipped: [] };

  const validRows: { rowNumber: number; data: ParsedItemRow }[] = [];
  for (const row of rows) {
    if (!row.data.sku && !row.data.vendor_cat) {
      summary.skipped.push({ row: row.rowNumber, reason: "Missing both SKU and Vendor Cat" });
      continue;
    }
    if (!row.data.description) {
      summary.skipped.push({ row: row.rowNumber, reason: "Missing description" });
      continue;
    }
    // Every item must record where it came from -- accept either value
    // case-insensitively but normalize to the canonical casing the app
    // and the item_master check constraint expect.
    const normalizedSource = row.data.source.trim().toLowerCase();
    const source = normalizedSource === "design" ? "Design" : normalizedSource === "estimation" ? "Estimation" : null;
    if (!source) {
      summary.skipped.push({
        row: row.rowNumber,
        reason: `Source must be "Design" or "Estimation" (got "${row.data.source.trim() || "blank"}")`,
      });
      continue;
    }
    // Net cost is always derived from List Price x (1 - Discount %) when a
    // list price is on the sheet -- Unit Cost is only a manual fallback for
    // rows with no list price at all. Mirrors effectiveNetRate, the same
    // formula BOM Builder/Feeder Master use to cost feeders.
    const unit_cost = Math.round(
      effectiveNetRate({ unit_cost: row.data.unit_cost, list_price: row.data.list_price, discount_pct: row.data.discount_pct }) * 100
    ) / 100;
    validRows.push({ ...row, data: { ...row.data, source, unit_cost } });
  }
  onProgress?.(rows.length - validRows.length, rows.length);

  // Paginated: a plain .select() truncates at the project's PostgREST
  // max-rows setting (Supabase defaults to 1000) -- with a catalog bigger
  // than that, an unpaginated fetch here would silently "not find" the
  // tail of the catalog and re-insert it as duplicates on every import.
  const existing: { id: string; sku: string | null; vendor_cat: string | null }[] = [];
  for (let from = 0; ; from += CHUNK_SIZE) {
    const { data, error: fetchError } = await supabase
      .from("item_master")
      .select("id, sku, vendor_cat")
      .range(from, from + CHUNK_SIZE - 1);
    if (fetchError) {
      for (const row of validRows) summary.skipped.push({ row: row.rowNumber, reason: fetchError.message });
      onProgress?.(rows.length, rows.length);
      return summary;
    }
    existing.push(...((data ?? []) as { id: string; sku: string | null; vendor_cat: string | null }[]));
    if (!data || data.length < CHUNK_SIZE) break;
  }

  const skuToId = new Map<string, string>();
  const vendorCatToId = new Map<string, string>();
  for (const item of existing) {
    if (item.sku) skuToId.set(item.sku, item.id);
    if (item.vendor_cat) vendorCatToId.set(item.vendor_cat, item.id);
  }

  // Resolve each row to a target id, keyed so a later duplicate row in the
  // same file (matching an earlier row's SKU/Vendor Cat) correctly targets
  // the same item instead of creating a second one. newIds tracks which
  // ids are genuinely new (not present in the catalog before this import
  // started) so that classification survives within-file duplicates.
  const newIds = new Set<string>();
  const order: string[] = [];
  const byId = new Map<string, Resolved>();
  for (const { rowNumber, data } of validRows) {
    const matchedId = (data.sku && skuToId.get(data.sku)) || (data.vendor_cat && vendorCatToId.get(data.vendor_cat));
    let id: string;
    if (matchedId) {
      id = matchedId;
    } else {
      id = crypto.randomUUID();
      newIds.add(id);
    }
    if (data.sku) skuToId.set(data.sku, id);
    if (data.vendor_cat) vendorCatToId.set(data.vendor_cat, id);
    if (!byId.has(id)) order.push(id);
    byId.set(id, { rowNumber, id, data, isNew: newIds.has(id) });
  }

  // The fuller compulsory-field rule (Make, Category, and -- for ACB/MCCB/MCB
  // -- Amps/Poles/kA) only applies to rows that create a brand-new item.
  // A row that updates an existing catalog entry keeps the lighter rule
  // above: legacy rows that predate this policy shouldn't suddenly fail to
  // update over a price/uom change just because they've never had a Make
  // or Category filled in.
  const toInsert: Resolved[] = [];
  const toUpdate: Resolved[] = [];
  for (const id of order) {
    const resolved = byId.get(id)!;
    if (!resolved.isNew) {
      toUpdate.push(resolved);
      continue;
    }
    const fieldError = validateNewItemFields({
      sku: resolved.data.sku,
      vendorCat: resolved.data.vendor_cat,
      description: resolved.data.description,
      make: resolved.data.make,
      category: resolved.data.category,
      source: resolved.data.source,
      amps: resolved.data.amps,
      poles: resolved.data.poles,
      ka: resolved.data.ka,
    });
    if (fieldError) {
      summary.skipped.push({ row: resolved.rowNumber, reason: fieldError });
      continue;
    }
    toInsert.push(resolved);
  }

  let done = summary.skipped.length;
  const total = rows.length;

  async function writeChunked(items: Resolved[], mode: "insert" | "update") {
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const payload = chunk.map((r) => ({ ...r.data, id: r.id, updated_at: new Date().toISOString() }));
      const { error } =
        mode === "insert"
          ? await supabase.from("item_master").insert(payload)
          : await supabase.from("item_master").upsert(payload, { onConflict: "id" });

      if (!error) {
        if (mode === "insert") summary.created += chunk.length;
        else summary.updated += chunk.length;
      } else {
        // A whole-chunk failure (e.g. one bad row) falls back to writing
        // that chunk's rows individually so we can report exactly which
        // row failed and why, without losing the rest of the chunk.
        for (const r of chunk) {
          const row = { ...r.data, id: r.id, updated_at: new Date().toISOString() };
          const { error: rowError } =
            mode === "insert"
              ? await supabase.from("item_master").insert(row)
              : await supabase.from("item_master").upsert(row, { onConflict: "id" });
          if (rowError) {
            summary.skipped.push({ row: r.rowNumber, reason: rowError.message });
          } else if (mode === "insert") {
            summary.created += 1;
          } else {
            summary.updated += 1;
          }
        }
      }

      done += chunk.length;
      onProgress?.(done, total);
    }
  }

  await writeChunked(toInsert, "insert");
  await writeChunked(toUpdate, "update");

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
