import type { SupabaseClient } from "@supabase/supabase-js";
import { DEVICE_TYPE_LABELS } from "@/lib/artuk-sizing";
import { FEEDER_TYPES, computeFeederTag } from "@/lib/feeder-tag";
import { validateNewItemFields } from "@/lib/item-display";
import type { DeviceType, Feeder, ItemMaster, ItemSource } from "@/types/database";

// Template columns, in the order the generated .xlsx uses -- shared by the
// parser (reading these keys out of the header row) and the failed-rows
// re-export (writing a workbook back out with the same columns). The
// item_name/item_make/item_category columns only matter when the item they
// describe doesn't exist yet -- they pre-fill the missing-item review table
// instead of the user having to type them there (Item Master's own
// compulsory-field rule -- see validateNewItemFields -- requires them to
// create the item either way).
export const TEMPLATE_COLUMNS = [
  "feeder_name",
  "feeder_type",
  "device_type",
  "rated_current",
  "rated_kw",
  "pole_config",
  "breaking_capacity",
  "item_sku",
  "item_vendor_cat",
  "item_name",
  "item_make",
  "item_category",
  "item_qty",
] as const;

const DEVICE_TYPE_SET = new Set(Object.keys(DEVICE_TYPE_LABELS));
const FEEDER_TYPE_SET = new Set(FEEDER_TYPES);

export type ParsedFeederLine = {
  rowNumber: number;
  feederName: string;
  feederType: string | null;
  deviceType: DeviceType | null;
  ratedCurrent: number | null;
  ratedKw: number | null;
  poleConfig: string | null;
  breakingCapacity: string | null;
  itemSku: string | null;
  itemVendorCat: string | null;
  itemName: string | null;
  itemMake: string | null;
  itemCategory: string | null;
  qty: number;
  raw: Record<string, string>;
};

export type RowError = { rowNumber: number; reason: string; raw: Record<string, string> };

// A minimal shape an ExcelJS.Worksheet satisfies -- keeps this module free
// of a hard ExcelJS dependency (same separation as item-import.ts, which
// this mirrors: ExcelJS only ever gets imported in the "use client" dialog
// that actually reads/writes .xlsx bytes).
export type SheetLike = {
  getRow(n: number): { eachCell(cb: (cell: { value: unknown }, col: number) => void): void };
  eachRow(cb: (row: { getCell(i: number): { value: unknown }; cellCount: number }, rowNumber: number) => void): void;
};

export function parseFeederSheet(sheet: SheetLike): { lines: ParsedFeederLine[]; rowErrors: RowError[] } {
  const headerRow = sheet.getRow(1);
  const columnIndex: Record<string, number> = {};
  headerRow.eachCell((cell, colNumber) => {
    const key = String(cell.value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (key) columnIndex[key] = colNumber;
  });

  const lines: ParsedFeederLine[] = [];
  const rowErrors: RowError[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (row.cellCount === 0) return;

    const cellText = (key: string) => {
      const idx = columnIndex[key];
      if (!idx) return "";
      const v = row.getCell(idx).value;
      if (v == null) return "";
      if (typeof v === "object" && "text" in v) return String((v as { text: string }).text);
      return String(v);
    };

    const raw: Record<string, string> = {};
    for (const col of TEMPLATE_COLUMNS) raw[col] = cellText(col).trim();

    if (!raw.feeder_name) {
      rowErrors.push({ rowNumber, reason: "Missing feeder_name", raw });
      return;
    }
    if (!raw.item_sku && !raw.item_vendor_cat) {
      rowErrors.push({ rowNumber, reason: "Missing both item_sku and item_vendor_cat", raw });
      return;
    }

    const feederType = raw.feeder_type && FEEDER_TYPE_SET.has(raw.feeder_type) ? raw.feeder_type : null;
    const deviceTypeKey = raw.device_type.toUpperCase().replace(/\s+/g, "_");
    const deviceType = DEVICE_TYPE_SET.has(deviceTypeKey) ? (deviceTypeKey as DeviceType) : null;
    const qtyNum = Number(raw.item_qty);
    const qty = raw.item_qty && !Number.isNaN(qtyNum) && qtyNum > 0 ? qtyNum : 1;

    lines.push({
      rowNumber,
      feederName: raw.feeder_name,
      feederType,
      deviceType,
      ratedCurrent: raw.rated_current ? Number(raw.rated_current) || null : null,
      ratedKw: raw.rated_kw ? Number(raw.rated_kw) || null : null,
      poleConfig: raw.pole_config || null,
      breakingCapacity: raw.breaking_capacity || null,
      itemSku: raw.item_sku || null,
      itemVendorCat: raw.item_vendor_cat || null,
      itemName: raw.item_name || null,
      itemMake: raw.item_make || null,
      itemCategory: raw.item_category || null,
      qty,
      raw,
    });
  });

  return { lines, rowErrors };
}

// ---- Grouping & classification ----

export type FeederGroup = {
  key: string;
  displayName: string;
  lines: ParsedFeederLine[];
};

// Rows sharing the same feeder_name (trimmed, case-insensitive) belong to
// the same feeder -- feeder-level fields (type/device/rating/...) are read
// from whichever line in the group has them first, since later rows for
// the same feeder are allowed to leave them blank.
export function groupFeederLines(lines: ParsedFeederLine[]): FeederGroup[] {
  const byKey = new Map<string, FeederGroup>();
  const order: string[] = [];
  for (const line of lines) {
    const key = line.feederName.trim().toLowerCase();
    let group = byKey.get(key);
    if (!group) {
      group = { key, displayName: line.feederName.trim(), lines: [] };
      byKey.set(key, group);
      order.push(key);
    }
    group.lines.push(line);
  }
  return order.map((k) => byKey.get(k)!);
}

export type ClassifiedGroup = FeederGroup & { mode: "create" | "extend"; existingFeeder?: Feeder };

// A group whose name matches an existing library feeder extends it
// (adds only new lines, never touches the feeder's own fields or existing
// lines); everything else is a brand-new feeder.
export function classifyGroups(groups: FeederGroup[], existingFeeders: Feeder[]): ClassifiedGroup[] {
  const byName = new Map<string, Feeder>();
  for (const f of existingFeeders) byName.set(f.name.trim().toLowerCase(), f);
  return groups.map((g) => {
    const existing = byName.get(g.key);
    return existing ? { ...g, mode: "extend" as const, existingFeeder: existing } : { ...g, mode: "create" as const };
  });
}

// ---- Item resolution ----

export type ItemIndex = { bySku: Map<string, ItemMaster>; byVendorCat: Map<string, ItemMaster> };

export function buildItemIndex(items: ItemMaster[]): ItemIndex {
  const bySku = new Map<string, ItemMaster>();
  const byVendorCat = new Map<string, ItemMaster>();
  for (const item of items) {
    if (item.sku) bySku.set(item.sku, item);
    if (item.vendor_cat) byVendorCat.set(item.vendor_cat, item);
  }
  return { bySku, byVendorCat };
}

function resolveItemForLine(line: ParsedFeederLine, index: ItemIndex): ItemMaster | null {
  if (line.itemSku && index.bySku.has(line.itemSku)) return index.bySku.get(line.itemSku)!;
  if (line.itemVendorCat && index.byVendorCat.has(line.itemVendorCat)) return index.byVendorCat.get(line.itemVendorCat)!;
  return null;
}

export type MissingItemRef = {
  sku: string | null;
  vendorCat: string | null;
  itemName: string | null;
  itemMake: string | null;
  itemCategory: string | null;
  lineCount: number;
};

export function findMissingItems(groups: ClassifiedGroup[], index: ItemIndex): MissingItemRef[] {
  const byKey = new Map<string, MissingItemRef>();
  for (const g of groups) {
    for (const line of g.lines) {
      if (resolveItemForLine(line, index)) continue;
      const key = `${line.itemSku ?? ""}|${line.itemVendorCat ?? ""}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.lineCount += 1;
        continue;
      }
      // First line referencing this missing item wins for pre-fill values,
      // same "first row wins" convention as feeder-level fields.
      byKey.set(key, {
        sku: line.itemSku,
        vendorCat: line.itemVendorCat,
        itemName: line.itemName,
        itemMake: line.itemMake,
        itemCategory: line.itemCategory,
        lineCount: 1,
      });
    }
  }
  return Array.from(byKey.values());
}

// ---- Missing-item review drafts (the user-editable table) ----

export type MissingItemDraft = {
  key: string;
  sku: string;
  vendorCat: string;
  description: string;
  make: string;
  category: string;
  source: ItemSource | "";
  amps: string;
  poles: string;
  ka: string;
  unitCost: string;
  create: boolean;
};

export function buildMissingItemDrafts(missing: MissingItemRef[]): MissingItemDraft[] {
  return missing.map((m) => ({
    key: `${m.sku ?? ""}|${m.vendorCat ?? ""}`,
    sku: m.sku ?? "",
    vendorCat: m.vendorCat ?? "",
    description: m.itemName ?? "",
    make: m.itemMake ?? "",
    category: m.itemCategory ?? "",
    source: m.sku ? "" : "Estimation",
    amps: "",
    poles: "",
    ka: "",
    unitCost: "0",
    create: true,
  }));
}

// Same compulsory-field rule as CreateItemDialog and the item xlsx/Google
// Sheet import -- see validateNewItemFields.
export function validateMissingDraft(d: MissingItemDraft): string | null {
  return validateNewItemFields({
    sku: d.sku,
    vendorCat: d.vendorCat,
    description: d.description,
    make: d.make,
    category: d.category,
    source: d.source,
    amps: d.amps.trim() ? Number(d.amps) : null,
    poles: d.poles.trim() ? Number(d.poles) : null,
    ka: d.ka.trim() ? Number(d.ka) : null,
  });
}

function draftToItemRow(d: MissingItemDraft) {
  return {
    sku: d.sku.trim() || null,
    vendor_cat: d.vendorCat.trim() || null,
    description: d.description.trim(),
    make: d.make.trim() || null,
    category: d.category.trim() || null,
    source: d.source as ItemSource,
    status: "active" as const,
    amps: d.amps.trim() ? Number(d.amps) : null,
    frame: null,
    ka: d.ka.trim() ? Number(d.ka) : null,
    poles: d.poles.trim() ? Number(d.poles) : null,
    uom: "nos",
    unit_cost: Number(d.unitCost) || 0,
    list_price: null,
    discount_pct: null,
    supplier: null,
    notes: null,
  };
}

export async function createMissingItems(
  supabase: SupabaseClient,
  drafts: MissingItemDraft[]
): Promise<{ created: ItemMaster[]; errors: { key: string; reason: string }[] }> {
  const toCreate = drafts.filter((d) => d.create);
  const created: ItemMaster[] = [];
  const errors: { key: string; reason: string }[] = [];
  if (toCreate.length === 0) return { created, errors };

  const payload = toCreate.map(draftToItemRow);
  const { data, error } = await supabase.from("item_master").insert(payload).select("*");
  if (!error && data) {
    created.push(...(data as ItemMaster[]));
    return { created, errors };
  }

  // Whole-batch failure (e.g. one bad row) falls back to one-by-one so a
  // single bad row doesn't sink every other item in the batch.
  for (const d of toCreate) {
    const { data: row, error: rowError } = await supabase.from("item_master").insert(draftToItemRow(d)).select("*").single();
    if (rowError || !row) errors.push({ key: d.key, reason: rowError?.message ?? "Could not create item." });
    else created.push(row as ItemMaster);
  }
  return { created, errors };
}

// ---- Planning the actual writes ----

export type PlannedLine = ParsedFeederLine & { item: ItemMaster };
export type PlannedNewFeeder = { group: ClassifiedGroup; lines: PlannedLine[] };
export type BlockedFeeder = { group: ClassifiedGroup; missingRefs: { sku: string | null; vendorCat: string | null }[] };
export type PlannedExtension = {
  feeder: Feeder;
  addLines: PlannedLine[];
  alreadyLinkedLines: ParsedFeederLine[];
  unresolvedLines: ParsedFeederLine[];
  startSortOrder: number;
};

export type ImportPlan = { newFeeders: PlannedNewFeeder[]; blockedFeeders: BlockedFeeder[]; extensions: PlannedExtension[] };

// Fetches, once, what every extend-mode feeder in this run already has
// linked (so a re-listed item doesn't get added twice) and the next free
// sort_order for each (so new lines append after its existing ones).
export async function fetchExtendContext(
  supabase: SupabaseClient,
  feederIds: string[]
): Promise<{ itemIdsByFeederId: Map<string, Set<string>>; nextSortOrderByFeederId: Map<string, number> }> {
  const itemIdsByFeederId = new Map<string, Set<string>>();
  const nextSortOrderByFeederId = new Map<string, number>();
  if (feederIds.length === 0) return { itemIdsByFeederId, nextSortOrderByFeederId };

  const { data } = await supabase.from("feeder_items").select("feeder_id, item_id, sort_order").in("feeder_id", feederIds);
  for (const row of (data ?? []) as { feeder_id: string; item_id: string; sort_order: number }[]) {
    if (!itemIdsByFeederId.has(row.feeder_id)) itemIdsByFeederId.set(row.feeder_id, new Set());
    itemIdsByFeederId.get(row.feeder_id)!.add(row.item_id);
    nextSortOrderByFeederId.set(row.feeder_id, Math.max(nextSortOrderByFeederId.get(row.feeder_id) ?? 0, row.sort_order + 1));
  }
  return { itemIdsByFeederId, nextSortOrderByFeederId };
}

// A brand-new feeder needs every one of its lines resolved -- a partial
// new feeder isn't created. An existing feeder being extended is never
// blocked this way: it just adds whatever lines resolve and skips the
// rest (the feeder it's extending already exists and works either way).
export function planImport(
  groups: ClassifiedGroup[],
  index: ItemIndex,
  itemIdsByFeederId: Map<string, Set<string>>,
  nextSortOrderByFeederId: Map<string, number>
): ImportPlan {
  const newFeeders: PlannedNewFeeder[] = [];
  const blockedFeeders: BlockedFeeder[] = [];
  const extensions: PlannedExtension[] = [];

  for (const g of groups) {
    if (g.mode === "create") {
      const resolved: PlannedLine[] = [];
      const missingRefs: { sku: string | null; vendorCat: string | null }[] = [];
      for (const line of g.lines) {
        const item = resolveItemForLine(line, index);
        if (item) resolved.push({ ...line, item });
        else missingRefs.push({ sku: line.itemSku, vendorCat: line.itemVendorCat });
      }
      if (missingRefs.length > 0) blockedFeeders.push({ group: g, missingRefs });
      else newFeeders.push({ group: g, lines: resolved });
    } else {
      const feederId = g.existingFeeder!.id;
      const existingItemIds = itemIdsByFeederId.get(feederId) ?? new Set<string>();
      const startSortOrder = nextSortOrderByFeederId.get(feederId) ?? 0;
      const addLines: PlannedLine[] = [];
      const alreadyLinkedLines: ParsedFeederLine[] = [];
      const unresolvedLines: ParsedFeederLine[] = [];
      const seen = new Set<string>();
      for (const line of g.lines) {
        const item = resolveItemForLine(line, index);
        if (!item) {
          unresolvedLines.push(line);
          continue;
        }
        if (existingItemIds.has(item.id) || seen.has(item.id)) {
          alreadyLinkedLines.push(line);
          continue;
        }
        seen.add(item.id);
        addLines.push({ ...line, item });
      }
      extensions.push({ feeder: g.existingFeeder!, addLines, alreadyLinkedLines, unresolvedLines, startSortOrder });
    }
  }

  return { newFeeders, blockedFeeders, extensions };
}

// ---- Executing the plan ----

export type FeederImportSummary = {
  feedersCreated: number;
  feedersExtended: number;
  linesAdded: number;
  feedersSkipped: { name: string; reason: string; rowNumber: number }[];
  rowsSkipped: { row: number; reason: string }[];
  failedRows: RowError[];
};

export async function executeImport(supabase: SupabaseClient, plan: ImportPlan, allExistingFeeders: Feeder[]): Promise<FeederImportSummary> {
  const summary: FeederImportSummary = {
    feedersCreated: 0,
    feedersExtended: 0,
    linesAdded: 0,
    feedersSkipped: [],
    rowsSkipped: [],
    failedRows: [],
  };

  for (const b of plan.blockedFeeders) {
    const missingDesc = b.missingRefs.map((r) => r.sku || r.vendorCat || "?").join(", ");
    const reason = `Not created -- missing item(s): ${missingDesc}`;
    summary.feedersSkipped.push({ name: b.group.displayName, reason, rowNumber: b.group.lines[0]?.rowNumber ?? 0 });
    for (const line of b.group.lines) summary.failedRows.push({ rowNumber: line.rowNumber, reason: "Feeder not created (missing item)", raw: line.raw });
  }

  for (const ext of plan.extensions) {
    for (const line of ext.unresolvedLines) {
      summary.rowsSkipped.push({ row: line.rowNumber, reason: "Item not created -- line not added" });
      summary.failedRows.push({ rowNumber: line.rowNumber, reason: "Item not created -- line not added", raw: line.raw });
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Tag sequence numbers depend on every other feeder that exists, tracked
  // across this whole run so feeders created earlier in the same import
  // count toward later ones' sequence numbers.
  const tagPool = [...allExistingFeeders];
  for (const nf of plan.newFeeders) {
    const first = nf.group.lines[0];
    const category = first.feederType ?? "";
    const ratedCurrent = first.ratedCurrent != null ? String(first.ratedCurrent) : "";
    const firstMake = nf.lines[0]?.item.make ?? null;
    const tag = computeFeederTag(category, ratedCurrent, firstMake, tagPool, null);

    const { data: feederRow, error } = await supabase
      .from("feeders")
      .insert({
        name: nf.group.displayName,
        category: first.feederType,
        tag,
        device_type: first.deviceType,
        rated_current: first.ratedCurrent,
        rated_kw: first.ratedKw,
        pole_config: first.poleConfig,
        breaking_capacity: first.breakingCapacity,
        is_library: true,
        created_by: user?.id ?? null,
      })
      .select("*")
      .single();

    if (error || !feederRow) {
      const reason = error?.message ?? "Could not create feeder.";
      summary.feedersSkipped.push({ name: nf.group.displayName, reason, rowNumber: first.rowNumber });
      for (const line of nf.group.lines) summary.failedRows.push({ rowNumber: line.rowNumber, reason, raw: line.raw });
      continue;
    }
    tagPool.push(feederRow as Feeder);

    const linesPayload = nf.lines.map((l, i) => ({ feeder_id: feederRow.id, item_id: l.item.id, qty: l.qty, sort_order: i }));
    const { error: linesError } = await supabase.from("feeder_items").insert(linesPayload);
    if (linesError) {
      const reason = `Feeder created but items failed: ${linesError.message}`;
      summary.feedersSkipped.push({ name: nf.group.displayName, reason, rowNumber: first.rowNumber });
      for (const line of nf.group.lines) summary.failedRows.push({ rowNumber: line.rowNumber, reason, raw: line.raw });
      continue;
    }
    summary.feedersCreated += 1;
  }

  for (const ext of plan.extensions) {
    if (ext.addLines.length === 0) continue;
    const payload = ext.addLines.map((l, i) => ({ feeder_id: ext.feeder.id, item_id: l.item.id, qty: l.qty, sort_order: ext.startSortOrder + i }));
    const { error } = await supabase.from("feeder_items").insert(payload);
    if (error) {
      for (const line of ext.addLines) summary.failedRows.push({ rowNumber: line.rowNumber, reason: error.message, raw: line.raw });
      continue;
    }
    summary.feedersExtended += 1;
    summary.linesAdded += ext.addLines.length;
  }

  return summary;
}

// Records a feeder import run in import_logs so it shows up in the same
// admin audit log the item xlsx/Google Sheet imports use.
export async function logFeederImport(
  supabase: SupabaseClient,
  params: { fileName?: string | null; itemsCreated: number; summary: FeederImportSummary; importedByName?: string | null }
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const failures = [
    ...params.summary.feedersSkipped.map((f) => ({ row: f.rowNumber, reason: `${f.name}: ${f.reason}` })),
    ...params.summary.rowsSkipped,
  ];
  await supabase.from("import_logs").insert({
    source: "feeder_xlsx_upload",
    file_name: params.fileName ?? null,
    created_count: params.summary.feedersCreated,
    updated_count: params.itemsCreated,
    failed_count: failures.length,
    failures,
    details: { feeders_extended: params.summary.feedersExtended, lines_added: params.summary.linesAdded },
    imported_by: user?.id ?? null,
    imported_by_name: params.importedByName ?? null,
  });
}
