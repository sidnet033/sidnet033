"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/client";
import { fetchAllItemMaster } from "@/lib/item-display";
import type { ItemMaster, ItemStatus } from "@/types/database";
import { XlsUpload } from "@/components/xls-upload";
import { SheetSyncButton } from "@/components/sheet-sync-button";
import { Icon } from "@/components/icon";
import { SavingOverlay } from "@/components/saving-overlay";
import { CreateItemDialog } from "@/components/create-item-dialog";
import { numericKeyGuard } from "@/lib/numeric-input";
import type { ItemSource } from "@/types/database";

const EMPTY_DRAFT = {
  sku: "",
  vendor_cat: "",
  description: "",
  make: "",
  category: "",
  source: "Estimation" as ItemSource,
  status: "active" as ItemStatus,
  amps: "",
  ka: "",
  poles: "",
  uom: "nos",
  unit_cost: "0",
  list_price: "",
  discount_pct: "",
  supplier: "",
  notes: "",
};

type Draft = typeof EMPTY_DRAFT;

const CSV_FIELDS: (keyof ItemMaster)[] = [
  "sku",
  "vendor_cat",
  "description",
  "make",
  "category",
  "source",
  "status",
  "amps",
  "ka",
  "poles",
  "uom",
  "unit_cost",
  "list_price",
  "discount_pct",
  "supplier",
  "notes",
];

const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

const MAKE_COLORS = [
  "bg-surface-container text-primary",
  "bg-secondary-container text-on-secondary-container",
  "bg-surface-container-high text-on-surface",
  "bg-tertiary-fixed text-on-tertiary-fixed",
  "bg-surface-container text-secondary",
];

const STATUS_LABELS: Record<ItemStatus, string> = {
  active: "Active",
  inactive: "Pending Review",
  discontinued: "Archived",
};

type ColumnKey =
  | "sku"
  | "vendor_cat"
  | "description"
  | "category"
  | "make"
  | "source"
  | "uom"
  | "unit_cost"
  | "list_price"
  | "discount_pct"
  | "amps"
  | "poles"
  | "ka"
  | "status";

const ALL_COLUMNS: ColumnKey[] = [
  "sku",
  "vendor_cat",
  "description",
  "category",
  "make",
  "source",
  "uom",
  "unit_cost",
  "list_price",
  "discount_pct",
  "amps",
  "poles",
  "ka",
  "status",
];

const COLUMN_LABELS: Record<ColumnKey, string> = {
  sku: "SKU",
  vendor_cat: "Vendor Cat",
  description: "Description",
  category: "Category",
  make: "Make",
  source: "Source",
  uom: "UOM",
  unit_cost: "Unit Cost",
  list_price: "List Price",
  discount_pct: "Disc %",
  amps: "Amps",
  poles: "Poles",
  ka: "kA",
  status: "Status",
};

const COLUMN_ALIGN: Record<ColumnKey, "left" | "right" | "center"> = {
  sku: "left",
  vendor_cat: "left",
  description: "left",
  category: "left",
  make: "left",
  source: "left",
  uom: "center",
  unit_cost: "right",
  list_price: "right",
  discount_pct: "center",
  amps: "right",
  poles: "center",
  ka: "right",
  status: "left",
};

const CELL_CLASS: Record<ColumnKey, string> = {
  sku: "px-2 font-display font-semibold text-primary",
  vendor_cat: "px-2 font-display text-secondary",
  description: "max-w-[420px] whitespace-normal break-words px-2 py-1.5 align-top text-on-surface",
  category: "px-2",
  make: "px-2",
  source: "px-2",
  uom: "px-2 text-center font-display text-secondary",
  unit_cost: "px-2 text-right font-display font-bold tabular-nums text-on-surface",
  list_price: "px-2 text-right font-display tabular-nums text-secondary line-through",
  discount_pct: "px-2 text-center",
  amps: "px-2 text-right font-display font-semibold tabular-nums text-on-surface",
  poles: "px-2 text-center font-display tabular-nums text-on-surface",
  ka: "px-2 text-right font-display font-bold tabular-nums text-primary",
  status: "px-2",
};

const VIEW_STORAGE_KEY = "item-master-view";

type SavedView = {
  search?: string;
  statusFilter?: string;
  makeFilter?: string;
  categoryFilter?: string;
  ampsFilter?: string;
  polesFilter?: string;
  kaFilter?: string;
  rowsPerPage?: number;
  columnOrder?: string[];
  visibleColumns?: string[];
  sortKey?: string | null;
  sortDir?: "asc" | "desc";
};

function loadSavedView(): SavedView {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedView) : {};
  } catch {
    return {};
  }
}

function patchSavedView(patch: Partial<SavedView>) {
  if (typeof window === "undefined") return;
  try {
    const current = loadSavedView();
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // ignore
  }
}

function isColumnKey(v: string): v is ColumnKey {
  return (ALL_COLUMNS as string[]).includes(v);
}

function makeColor(make: string) {
  let hash = 0;
  for (let i = 0; i < make.length; i++) hash = (hash * 31 + make.charCodeAt(i)) >>> 0;
  return MAKE_COLORS[hash % MAKE_COLORS.length];
}

function getPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = Array.from(pages)
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const result: (number | "...")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push("...");
    result.push(p);
    prev = p;
  }
  return result;
}

function draftToRow(d: Draft) {
  return {
    sku: d.sku.trim() || null,
    vendor_cat: d.vendor_cat.trim() || null,
    description: d.description.trim(),
    make: d.make.trim() || null,
    category: d.category.trim() || null,
    source: d.source,
    status: d.status,
    amps: d.amps.trim() ? Number(d.amps) : null,
    ka: d.ka.trim() ? Number(d.ka) : null,
    poles: d.poles.trim() ? Number(d.poles) : null,
    uom: d.uom.trim() || "nos",
    unit_cost: Number(d.unit_cost) || 0,
    list_price: d.list_price.trim() ? Number(d.list_price) : null,
    discount_pct: d.discount_pct.trim() ? Number(d.discount_pct) : null,
    supplier: d.supplier.trim() || null,
    notes: d.notes.trim() || null,
  };
}

function validateDraft(d: Draft): string | null {
  if (!d.sku.trim() && !d.vendor_cat.trim()) return "Either SKU or Vendor Cat is required.";
  if (!d.description.trim()) return "Description is required.";
  return null;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: ItemMaster[]) {
  const lines = [CSV_FIELDS.join(",")];
  for (const item of rows) lines.push(CSV_FIELDS.map((f) => csvEscape(item[f])).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadXlsx(filename: string, rows: ItemMaster[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Item Master");
  sheet.columns = CSV_FIELDS.map((f) => ({ header: f, key: f, width: 18 }));
  for (const item of rows) {
    sheet.addRow(Object.fromEntries(CSV_FIELDS.map((f) => [f, item[f]])));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ItemMasterTable({
  initialItems,
  isAdmin,
  initialSearch = "",
  currentUserName,
}: {
  initialItems: ItemMaster[];
  isAdmin: boolean;
  initialSearch?: string;
  currentUserName: string;
}) {
  const [items, setItems] = useState<ItemMaster[]>(initialItems);
  const [search, setSearch] = useState(() => initialSearch || loadSavedView().search || "");
  const [statusFilter, setStatusFilter] = useState<"all" | ItemStatus>(
    () => (loadSavedView().statusFilter as "all" | ItemStatus) || "all"
  );
  const [makeFilter, setMakeFilter] = useState(() => loadSavedView().makeFilter || "");
  const [categoryFilter, setCategoryFilter] = useState(() => loadSavedView().categoryFilter || "");
  const [ampsFilter, setAmpsFilter] = useState(() => loadSavedView().ampsFilter || "");
  const [polesFilter, setPolesFilter] = useState(() => loadSavedView().polesFilter || "");
  const [kaFilter, setKaFilter] = useState(() => loadSavedView().kaFilter || "");
  const [rowsPerPage, setRowsPerPage] = useState(() => loadSavedView().rowsPerPage || 25);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [savedViewFlash, setSavedViewFlash] = useState(false);

  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() => {
    const saved = (loadSavedView().columnOrder ?? []).filter(isColumnKey);
    const missing = ALL_COLUMNS.filter((k) => !saved.includes(k));
    return saved.length > 0 ? [...saved, ...missing] : [...ALL_COLUMNS];
  });
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    const saved = (loadSavedView().visibleColumns ?? []).filter(isColumnKey);
    return new Set(saved.length > 0 ? saved : ALL_COLUMNS);
  });
  const [columnsOpen, setColumnsOpen] = useState(false);

  const [sortKey, setSortKey] = useState<ColumnKey | null>(() => {
    const saved = loadSavedView().sortKey;
    return saved && isColumnKey(saved) ? saved : null;
  });
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => loadSavedView().sortDir ?? "asc");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDiscountOpen, setBulkDiscountOpen] = useState(false);
  const [bulkDiscountValue, setBulkDiscountValue] = useState("");

  const [page, setPage] = useState(1);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const supabase = useMemo(() => createClient(), []);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const distinctMakes = useMemo(
    () => Array.from(new Set(items.map((i) => i.make).filter((v): v is string => !!v))).sort(),
    [items]
  );
  const distinctCategories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter((v): v is string => !!v))).sort(),
    [items]
  );
  const distinctAmps = useMemo(
    () => Array.from(new Set(items.map((i) => i.amps).filter((v): v is number => v != null))).sort((a, b) => a - b),
    [items]
  );
  const distinctPoles = useMemo(
    () => Array.from(new Set(items.map((i) => i.poles).filter((v): v is number => v != null))).sort((a, b) => a - b),
    [items]
  );
  const distinctKa = useMemo(
    () => Array.from(new Set(items.map((i) => i.ka).filter((v): v is number => v != null))).sort((a, b) => a - b),
    [items]
  );

  // Items sharing a SKU, Vendor Cat, or Description (case/whitespace
  // insensitive) with another item — candidates for cleanup.
  const duplicateIds = useMemo(() => {
    const bySku = new Map<string, string[]>();
    const byVendorCat = new Map<string, string[]>();
    const byDescription = new Map<string, string[]>();
    for (const item of items) {
      if (item.sku) {
        const k = item.sku.trim().toLowerCase();
        bySku.set(k, [...(bySku.get(k) ?? []), item.id]);
      }
      if (item.vendor_cat) {
        const k = item.vendor_cat.trim().toLowerCase();
        byVendorCat.set(k, [...(byVendorCat.get(k) ?? []), item.id]);
      }
      const dk = item.description.trim().toLowerCase();
      if (dk) byDescription.set(dk, [...(byDescription.get(dk) ?? []), item.id]);
    }
    const dupIds = new Set<string>();
    for (const map of [bySku, byVendorCat, byDescription]) {
      for (const ids of map.values()) {
        if (ids.length > 1) ids.forEach((id) => dupIds.add(id));
      }
    }
    return dupIds;
  }, [items]);

  function matchesBase(item: ItemMaster) {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      (item.sku ?? "").toLowerCase().includes(q) ||
      (item.vendor_cat ?? "").toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      (item.make ?? "").toLowerCase().includes(q) ||
      (item.category ?? "").toLowerCase().includes(q);
    return (
      matchesSearch &&
      (!makeFilter || item.make === makeFilter) &&
      (!categoryFilter || item.category === categoryFilter) &&
      (!ampsFilter || String(item.amps ?? "") === ampsFilter) &&
      (!polesFilter || String(item.poles ?? "") === polesFilter) &&
      (!kaFilter || String(item.ka ?? "") === kaFilter) &&
      (!duplicatesOnly || duplicateIds.has(item.id))
    );
  }

  const baseFiltered = items.filter(matchesBase);
  const counts = {
    all: baseFiltered.length,
    active: baseFiltered.filter((i) => i.status === "active").length,
    inactive: baseFiltered.filter((i) => i.status === "inactive").length,
    discontinued: baseFiltered.filter((i) => i.status === "discontinued").length,
  };
  const filtered = statusFilter === "all" ? baseFiltered : baseFiltered.filter((i) => i.status === statusFilter);

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const av = a[sortKey as keyof ItemMaster];
        const bv = b[sortKey as keyof ItemMaster];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      })
    : filtered;

  const totalPages = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * rowsPerPage;
  const paged = sorted.slice(pageStart, pageStart + rowsPerPage);

  const filterKey = `${search}|${statusFilter}|${makeFilter}|${categoryFilter}|${ampsFilter}|${polesFilter}|${kaFilter}|${duplicatesOnly}|${rowsPerPage}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const hasActiveFilters =
    !!search ||
    statusFilter !== "all" ||
    !!makeFilter ||
    !!categoryFilter ||
    !!ampsFilter ||
    !!polesFilter ||
    !!kaFilter ||
    duplicatesOnly;

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setMakeFilter("");
    setCategoryFilter("");
    setAmpsFilter("");
    setPolesFilter("");
    setKaFilter("");
    setDuplicatesOnly(false);
  }

  function saveCurrentView() {
    const view: SavedView = {
      search,
      statusFilter,
      makeFilter,
      categoryFilter,
      ampsFilter,
      polesFilter,
      kaFilter,
      rowsPerPage,
      columnOrder,
      visibleColumns: Array.from(visibleColumns),
      sortKey,
      sortDir,
    };
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
    setSavedViewFlash(true);
    setTimeout(() => setSavedViewFlash(false), 1500);
  }

  function toggleColumn(key: ColumnKey) {
    setVisibleColumns((prev) => {
      if (prev.has(key) && prev.size === 1) return prev;
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      patchSavedView({ visibleColumns: Array.from(next) });
      return next;
    });
  }

  function moveColumn(key: ColumnKey, dir: -1 | 1) {
    setColumnOrder((prev) => {
      const idx = prev.indexOf(key);
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      patchSavedView({ columnOrder: next });
      return next;
    });
  }

  function handleSort(key: ColumnKey) {
    if (sortKey === key) {
      const nextDir = sortDir === "asc" ? "desc" : "asc";
      setSortDir(nextDir);
      patchSavedView({ sortKey: key, sortDir: nextDir });
    } else {
      setSortKey(key);
      setSortDir("asc");
      patchSavedView({ sortKey: key, sortDir: "asc" });
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    const pageIds = paged.map((i) => i.id);
    const allSelected = pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function refresh() {
    setItems(await fetchAllItemMaster(supabase));
  }

  function startEdit(item: ItemMaster) {
    setEditingId(item.id);
    setEditDraft({
      sku: item.sku ?? "",
      vendor_cat: item.vendor_cat ?? "",
      description: item.description,
      make: item.make ?? "",
      category: item.category ?? "",
      source: item.source,
      status: item.status,
      amps: item.amps === null ? "" : String(item.amps),
      ka: item.ka === null ? "" : String(item.ka),
      poles: item.poles === null ? "" : String(item.poles),
      uom: item.uom,
      unit_cost: String(item.unit_cost),
      list_price: item.list_price === null ? "" : String(item.list_price),
      discount_pct: item.discount_pct === null ? "" : String(item.discount_pct),
      supplier: item.supplier ?? "",
      notes: item.notes ?? "",
    });
  }

  async function saveEdit(id: string) {
    const validationError = validateDraft(editDraft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    const { error } = await supabase
      .from("item_master")
      .update({ ...draftToRow(editDraft), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }
    setEditingId(null);
    await refresh();
    setSaving(false);
  }

  // Optimistic: updates the row in place instead of re-fetching the whole
  // (potentially several-thousand-row) catalog, so the change is visible
  // immediately instead of after a multi-second full refetch.
  async function toggleArchive(item: ItemMaster) {
    const nextStatus: ItemStatus = item.status === "discontinued" ? "active" : "discontinued";
    const updatedAt = new Date().toISOString();
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: nextStatus, updated_at: updatedAt } : i)));
    const { error } = await supabase.from("item_master").update({ status: nextStatus, updated_at: updatedAt }).eq("id", item.id);
    if (error) {
      alert(error.message);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: item.status, updated_at: item.updated_at } : i)));
    }
  }

  async function handleArchiveSelected() {
    if (!confirm(`Archive ${selectedIds.size} item(s)? You can unarchive any of them later from the row's action button.`)) return;
    const ids = Array.from(selectedIds);
    const updatedAt = new Date().toISOString();
    setItems((prev) => prev.map((i) => (selectedIds.has(i.id) ? { ...i, status: "discontinued", updated_at: updatedAt } : i)));
    const { error } = await supabase
      .from("item_master")
      .update({ status: "discontinued", updated_at: updatedAt })
      .in("id", ids);
    if (error) {
      alert(error.message);
      refresh();
      return;
    }
    setSelectedIds(new Set());
  }

  async function applyBulkDiscount() {
    const value = Number(bulkDiscountValue);
    if (bulkDiscountValue.trim() === "" || Number.isNaN(value)) return;
    const { error } = await supabase
      .from("item_master")
      .update({ discount_pct: value, updated_at: new Date().toISOString() })
      .in("id", Array.from(selectedIds));
    if (error) {
      alert(error.message);
      return;
    }
    setBulkDiscountOpen(false);
    setBulkDiscountValue("");
    refresh();
  }

  function copySku(sku: string) {
    navigator.clipboard?.writeText(sku).catch(() => {});
  }

  function renderCell(item: ItemMaster, key: ColumnKey): React.ReactNode {
    switch (key) {
      case "sku":
        return (
          <div className="flex items-center gap-1">
            <span>{item.sku || "—"}</span>
            {item.sku && (
              <button
                onClick={() => copySku(item.sku!)}
                title="Copy SKU"
                className="text-secondary opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
              >
                <Icon name="content_copy" size={12} />
              </button>
            )}
          </div>
        );
      case "vendor_cat":
        return item.vendor_cat || "—";
      case "description":
        return item.description;
      case "category":
        return item.category ? (
          <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant">{item.category}</span>
        ) : (
          <span className="text-outline-variant">—</span>
        );
      case "make":
        return item.make ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${makeColor(item.make)}`}>{item.make}</span>
        ) : (
          <span className="text-outline-variant">—</span>
        );
      case "source":
        return <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant">{item.source}</span>;
      case "uom":
        return item.uom;
      case "unit_cost":
        return `₹${item.unit_cost.toLocaleString("en-IN")}`;
      case "list_price":
        return item.list_price != null ? `₹${item.list_price.toLocaleString("en-IN")}` : "";
      case "discount_pct":
        return item.discount_pct != null ? (
          <span className="rounded bg-tertiary-fixed px-1.5 py-0.5 text-[11px] font-bold text-on-tertiary-fixed">-{item.discount_pct}%</span>
        ) : (
          <span className="text-outline-variant">—</span>
        );
      case "amps":
        return item.amps ?? "—";
      case "poles":
        return item.poles ?? "—";
      case "ka":
        return item.ka ?? "—";
      case "status":
        return <StatusBadge status={item.status} />;
    }
  }

  function renderEditCell(key: ColumnKey): React.ReactNode {
    switch (key) {
      case "sku":
        return <input className="w-24 rounded border px-1 py-0.5" value={editDraft.sku} onChange={(e) => setEditDraft({ ...editDraft, sku: e.target.value })} />;
      case "vendor_cat":
        return <input className="w-24 rounded border px-1 py-0.5" value={editDraft.vendor_cat} onChange={(e) => setEditDraft({ ...editDraft, vendor_cat: e.target.value })} />;
      case "description":
        return <input className="w-full min-w-40 rounded border px-1 py-0.5" value={editDraft.description} onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })} />;
      case "category":
        return <input className="w-24 rounded border px-1 py-0.5" value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} />;
      case "make":
        return <input className="w-24 rounded border px-1 py-0.5" value={editDraft.make} onChange={(e) => setEditDraft({ ...editDraft, make: e.target.value })} />;
      case "source":
        return (
          <select
            className="rounded border px-1 py-0.5"
            value={editDraft.source}
            onChange={(e) => setEditDraft({ ...editDraft, source: e.target.value as ItemSource })}
          >
            <option value="Design">Design</option>
            <option value="Estimation">Estimation</option>
          </select>
        );
      case "uom":
        return <input className="w-16 rounded border px-1 py-0.5" value={editDraft.uom} onChange={(e) => setEditDraft({ ...editDraft, uom: e.target.value })} />;
      case "unit_cost":
        return <input type="text" inputMode="decimal" onKeyDown={numericKeyGuard()} className="w-24 rounded border px-1 py-0.5 text-right" value={editDraft.unit_cost} onChange={(e) => setEditDraft({ ...editDraft, unit_cost: e.target.value })} />;
      case "list_price":
        return <input type="text" inputMode="decimal" onKeyDown={numericKeyGuard()} className="w-24 rounded border px-1 py-0.5 text-right" value={editDraft.list_price} onChange={(e) => setEditDraft({ ...editDraft, list_price: e.target.value })} />;
      case "discount_pct":
        return <input type="text" inputMode="decimal" onKeyDown={numericKeyGuard()} className="w-16 rounded border px-1 py-0.5 text-right" value={editDraft.discount_pct} onChange={(e) => setEditDraft({ ...editDraft, discount_pct: e.target.value })} />;
      case "amps":
        return <input type="text" inputMode="decimal" onKeyDown={numericKeyGuard()} className="w-16 rounded border px-1 py-0.5 text-right" value={editDraft.amps} onChange={(e) => setEditDraft({ ...editDraft, amps: e.target.value })} />;
      case "poles":
        return <input type="text" inputMode="numeric" onKeyDown={numericKeyGuard()} className="w-14 rounded border px-1 py-0.5 text-right" value={editDraft.poles} onChange={(e) => setEditDraft({ ...editDraft, poles: e.target.value })} />;
      case "ka":
        return <input type="text" inputMode="decimal" onKeyDown={numericKeyGuard()} className="w-16 rounded border px-1 py-0.5 text-right" value={editDraft.ka} onChange={(e) => setEditDraft({ ...editDraft, ka: e.target.value })} />;
      case "status":
        return (
          <select className="rounded border px-1 py-0.5" value={editDraft.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value as ItemStatus })}>
            <option value="active">{STATUS_LABELS.active}</option>
            <option value="inactive">{STATUS_LABELS.inactive}</option>
            <option value="discontinued">{STATUS_LABELS.discontinued}</option>
          </select>
        );
    }
  }

  const selectedItems = items.filter((i) => selectedIds.has(i.id));
  const lastUpdatedAt = selectedItems.reduce<string | null>(
    (latest, i) => (!latest || i.updated_at > latest ? i.updated_at : latest),
    null
  );

  const visibleColumnList = columnOrder.filter((k) => visibleColumns.has(k));
  const totalCols = visibleColumnList.length + (isAdmin ? 2 : 0);

  return (
    <div className="space-y-3">
      <SavingOverlay show={saving} />
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-on-surface">Item Master</h1>
          <p className="text-sm text-secondary">
            Every component and its cost. Feeders in the Feeder Master are built from these items.
            {isAdmin ? "" : " Only admins can edit — ask an admin to make changes."}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/templates/item-master-template.xlsx"
              download
              className="flex h-8 items-center gap-1.5 rounded-[4px] bg-surface-container-lowest px-2.5 text-xs font-medium text-secondary shadow-sm hover:bg-surface-container-low"
            >
              Download template
            </a>
            <XlsUpload onDone={refresh} currentUserName={currentUserName} />
            <button
              onClick={() => downloadXlsx("item-master.xlsx", items)}
              className="flex h-8 items-center gap-1.5 rounded-[4px] bg-surface-container-lowest px-2.5 text-xs font-medium text-on-surface shadow-sm hover:bg-surface-container-low"
            >
              <Icon name="download" size={16} className="text-secondary" /> Export Item Master
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-[8px] bg-surface-container-lowest p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by SKU, part code, description, or ratings..."
              className="h-9 w-full rounded-[4px] bg-surface-container-low pl-8 pr-12 text-sm text-on-surface placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-surface-container-highest px-1.5 py-0.5 text-[10px] font-semibold text-secondary">
              ⌘K
            </span>
          </div>
          <FilterSelect className="w-36" value={makeFilter} onChange={setMakeFilter} allLabel="All makes" options={distinctMakes} />
          <FilterSelect
            className="w-36"
            value={categoryFilter}
            onChange={setCategoryFilter}
            allLabel="All categories"
            options={distinctCategories}
          />
          <FilterSelect
            className="w-28"
            value={ampsFilter}
            onChange={setAmpsFilter}
            allLabel="All amps"
            options={distinctAmps.map(String)}
          />
          <FilterSelect
            className="w-28"
            value={polesFilter}
            onChange={setPolesFilter}
            allLabel="All poles"
            options={distinctPoles.map(String)}
          />
          <FilterSelect className="w-28" value={kaFilter} onChange={setKaFilter} allLabel="All kA" options={distinctKa.map(String)} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/30 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-secondary">Status</span>
            <StatusChip label="All" count={counts.all} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
            <StatusChip
              label={STATUS_LABELS.active}
              count={counts.active}
              active={statusFilter === "active"}
              onClick={() => setStatusFilter("active")}
            />
            <StatusChip
              label={STATUS_LABELS.discontinued}
              count={counts.discontinued}
              active={statusFilter === "discontinued"}
              onClick={() => setStatusFilter("discontinued")}
            />
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="ml-1 flex items-center gap-1 text-xs text-secondary hover:text-error"
              >
                <Icon name="filter_alt_off" size={13} /> Clear all filters
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={saveCurrentView}
              className="flex h-8 items-center gap-1.5 rounded-[4px] bg-surface-container-low px-2.5 text-xs font-medium text-on-surface hover:bg-surface-container-high"
            >
              <Icon name="bookmark_border" size={14} className="text-secondary" />
              {savedViewFlash ? "Saved!" : "Save Current View"}
            </button>
            <div className="relative">
              <button
                onClick={() => setColumnsOpen((v) => !v)}
                className="flex h-8 items-center gap-1.5 rounded-[4px] bg-surface-container-low px-2.5 text-xs font-medium text-on-surface hover:bg-surface-container-high"
              >
                <Icon name="view_column" size={14} className="text-secondary" /> Customize Columns ({visibleColumns.size})
              </button>
              {columnsOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-[4px] bg-surface-container-lowest p-2 shadow-md">
                  <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-secondary">
                    Show, hide &amp; reorder columns
                  </p>
                  {columnOrder.map((key, idx) => (
                    <div key={key} className="flex items-center gap-1 rounded px-1 py-1 hover:bg-surface-container-low">
                      <div className="flex flex-col">
                        <button
                          disabled={idx === 0}
                          onClick={() => moveColumn(key, -1)}
                          className="text-secondary hover:text-primary disabled:opacity-20"
                        >
                          <Icon name="arrow_drop_up" size={16} />
                        </button>
                        <button
                          disabled={idx === columnOrder.length - 1}
                          onClick={() => moveColumn(key, 1)}
                          className="-mt-1.5 text-secondary hover:text-primary disabled:opacity-20"
                        >
                          <Icon name="arrow_drop_down" size={16} />
                        </button>
                      </div>
                      <label className="flex flex-1 items-center gap-2 text-xs text-on-surface">
                        <input type="checkbox" checked={visibleColumns.has(key)} onChange={() => toggleColumn(key)} className="rounded" />
                        {COLUMN_LABELS[key]}
                      </label>
                    </div>
                  ))}
                  <button
                    onClick={() => setColumnsOpen(false)}
                    className="mt-1 w-full rounded bg-surface-container-low py-1 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
            {isAdmin && (
              <>
                <SheetSyncButton onDone={refresh} currentUserName={currentUserName} />
                <button
                  onClick={() => setAddDialogOpen(true)}
                  className="flex h-8 items-center gap-1.5 rounded-[4px] bg-primary px-3 text-xs font-medium text-on-primary shadow-sm hover:bg-primary-container"
                >
                  <Icon name="add" size={14} /> Add item
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {duplicateIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-error/30 bg-error-container px-4 py-2.5 text-sm text-on-error-container">
          <span className="flex items-center gap-2">
            <Icon name="warning" size={16} />
            {duplicateIds.size} item(s) look like duplicates (matching SKU, Vendor Cat, or Description). Review and clean these up.
          </span>
          <button
            onClick={() => setDuplicatesOnly((v) => !v)}
            className="flex items-center gap-1.5 rounded bg-error px-2.5 py-1 text-xs font-medium text-on-error hover:bg-error/90"
          >
            {duplicatesOnly ? "Show all items" : "Show duplicates only"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-error">{error}</p>}

      <CreateItemDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onCreated={() => {
          setAddDialogOpen(false);
          refresh();
        }}
      />

      {isAdmin && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-inverse-surface px-4 py-2.5 text-inverse-on-surface shadow-md">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-primary text-on-primary text-[11px] font-bold">
              {selectedIds.size}
            </span>
            <span className="text-sm font-medium">item(s) selected</span>
            <div className="h-4 w-px bg-outline" />
            <div className="relative">
              <button
                onClick={() => setBulkDiscountOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded bg-surface-container-low px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-high"
              >
                Update Discount %
              </button>
              {bulkDiscountOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 flex items-center gap-1.5 rounded-[4px] bg-surface-container-lowest p-2 shadow-md">
                  <input
                    autoFocus
                    type="text"
                    inputMode="decimal"
                    value={bulkDiscountValue}
                    onChange={(e) => setBulkDiscountValue(e.target.value)}
                    onKeyDown={numericKeyGuard()}
                    placeholder="%"
                    className="w-16 rounded border border-outline-variant/50 px-1.5 py-1 text-xs text-on-surface"
                  />
                  <button onClick={applyBulkDiscount} className="rounded bg-primary px-2 py-1 text-xs font-medium text-on-primary hover:bg-primary-container">
                    Apply
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => downloadCsv("item-master-selected.csv", selectedItems)}
              className="flex items-center gap-1.5 rounded bg-surface-container-low px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-high"
            >
              <Icon name="file_download" size={14} /> Export selected
            </button>
            <button
              onClick={handleArchiveSelected}
              className="flex items-center gap-1.5 rounded bg-surface-container-low px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-high"
            >
              <Icon name="archive" size={14} /> Archive selected
            </button>
            {lastUpdatedAt && (
              <div className="flex items-center gap-1.5 border-l border-inverse-on-surface/20 pl-3 font-mono text-[11px] text-inverse-on-surface/80">
                <Icon name="schedule" size={14} className="text-inverse-on-surface/60" />
                Last updated:{" "}
                {new Date(lastUpdatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} by{" "}
                {currentUserName}
              </div>
            )}
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="text-inverse-on-surface/70 hover:text-inverse-on-surface">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-[8px] bg-surface-container-lowest shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="sticky top-0 z-10 bg-surface-container text-[10px] font-semibold uppercase tracking-wide text-secondary">
              <tr className="h-9 border-b border-outline-variant/30">
                {isAdmin && (
                  <th className="w-9 px-2 text-center">
                    <input
                      type="checkbox"
                      className="cursor-pointer rounded"
                      checked={paged.length > 0 && paged.every((i) => selectedIds.has(i.id))}
                      onChange={toggleSelectAllOnPage}
                    />
                  </th>
                )}
                {visibleColumnList.map((key) => (
                  <SortableTh
                    key={key}
                    label={COLUMN_LABELS[key]}
                    sortKey={key}
                    current={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    align={COLUMN_ALIGN[key]}
                    className={key === "description" ? "min-w-[240px]" : undefined}
                  />
                ))}
                {isAdmin && <th className="sticky right-0 bg-surface-container px-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {paged.map((item) =>
                editingId === item.id ? (
                  <tr key={item.id} className="bg-tertiary-fixed/40">
                    {isAdmin && <td />}
                    {visibleColumnList.map((key) => (
                      <td key={key} className="px-2 py-1">
                        {renderEditCell(key)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      <button onClick={() => saveEdit(item.id)} className="mr-2 text-xs font-medium text-tertiary hover:underline">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-secondary hover:underline">Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={item.id} className="group h-8 hover:bg-surface-container-low">
                    {isAdmin && (
                      <td className="px-2 text-center">
                        <input
                          type="checkbox"
                          className="cursor-pointer rounded"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelected(item.id)}
                        />
                      </td>
                    )}
                    {visibleColumnList.map((key) => (
                      <td key={key} className={CELL_CLASS[key]} title={key === "description" ? item.description : undefined}>
                        {renderCell(item, key)}
                      </td>
                    ))}
                    {isAdmin && (
                      <td className="sticky right-0 bg-surface-container-lowest px-2 text-right group-hover:bg-surface-container-low">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => startEdit(item)} title="Edit" className="rounded p-1 text-secondary hover:bg-surface-container hover:text-primary">
                            <Icon name="edit" size={15} />
                          </button>
                          <button
                            onClick={() => toggleArchive(item)}
                            title={item.status === "discontinued" ? "Unarchive" : "Archive"}
                            className="rounded p-1 text-secondary hover:bg-surface-container hover:text-error"
                          >
                            <Icon name={item.status === "discontinued" ? "unarchive" : "archive"} size={15} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              )}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={totalCols} className="px-3 py-10 text-center text-sm text-secondary">
                    No items found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-center justify-between gap-2 border-t border-outline-variant/30 bg-surface-container-low px-4 py-2.5 sm:flex-row">
          <div className="flex items-center gap-4">
            <span className="text-xs text-secondary">
              Showing <span className="font-semibold text-on-surface">{sorted.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + rowsPerPage, sorted.length)}</span> of{" "}
              <span className="font-semibold text-on-surface">{sorted.length}</span> items
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase text-secondary">Rows:</span>
              <select
                value={rowsPerPage}
                onChange={(e) => setRowsPerPage(Number(e.target.value))}
                className="h-7 rounded border border-outline-variant/50 bg-surface-container-lowest px-1.5 text-xs focus:outline-none"
              >
                {ROWS_PER_PAGE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <PageButton icon="first_page" disabled={currentPage === 1} onClick={() => setPage(1)} />
            <PageButton icon="chevron_left" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} />
            {getPageNumbers(currentPage, totalPages).map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="px-1 font-display text-xs text-secondary">
                  ...
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`flex h-7 w-7 items-center justify-center rounded font-display text-xs font-semibold ${
                    p === currentPage ? "bg-primary text-on-primary" : "text-secondary hover:bg-surface-container"
                  }`}
                >
                  {p}
                </button>
              )
            )}
            <PageButton icon="chevron_right" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} />
            <PageButton icon="last_page" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: string[];
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded-[4px] bg-surface-container-low px-3 pr-8 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <Icon name="expand_more" size={16} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-secondary" />
    </div>
  );
}

function StatusChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition-colors ${
        active ? "bg-primary-container text-on-primary-container" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"
      }`}
    >
      <span>{label}</span>
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-primary text-on-primary" : "bg-surface-container-highest text-secondary"}`}>{count}</span>
    </button>
  );
}

function SortableTh({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  sortKey: ColumnKey;
  current: ColumnKey | null;
  dir: "asc" | "desc";
  onSort: (key: ColumnKey) => void;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const active = current === sortKey;
  const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-between";
  return (
    <th className={`cursor-pointer select-none px-2 hover:text-on-surface ${className}`} onClick={() => onSort(sortKey)}>
      <div className={`flex items-center gap-1 ${justify}`}>
        <span>{label}</span>
        {active ? (
          <Icon name={dir === "asc" ? "arrow_upward" : "arrow_downward"} size={13} className="text-primary" />
        ) : (
          <Icon name="unfold_more" size={13} className="text-outline-variant" />
        )}
      </div>
    </th>
  );
}

function PageButton({ icon, disabled, onClick }: { icon: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-secondary transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

function StatusBadge({ status }: { status: ItemStatus }) {
  const styles: Record<ItemStatus, string> = {
    active: "text-tertiary",
    inactive: "text-secondary",
    discontinued: "text-error",
  };
  const dots: Record<ItemStatus, string> = {
    active: "bg-tertiary-container",
    inactive: "bg-secondary",
    discontinued: "bg-error",
  };
  return (
    <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${styles[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dots[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

