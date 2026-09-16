"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ItemMaster, ItemStatus } from "@/types/database";
import { XlsUpload } from "@/components/xls-upload";
import { SheetSyncButton } from "@/components/sheet-sync-button";
import { Icon } from "@/components/icon";

const EMPTY_DRAFT = {
  sku: "",
  vendor_cat: "",
  description: "",
  make: "",
  category: "",
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
  discontinued: "Discontinued",
};

const TOGGLEABLE_COLUMNS: { key: string; label: string }[] = [
  { key: "vendor_cat", label: "Vendor Cat" },
  { key: "category", label: "Category" },
  { key: "make", label: "Make" },
  { key: "uom", label: "UOM" },
  { key: "list_price", label: "List Price" },
  { key: "discount_pct", label: "Disc %" },
  { key: "amps", label: "Amps" },
  { key: "poles", label: "Poles" },
  { key: "ka", label: "kA" },
];

const VIEW_STORAGE_KEY = "item-master-view";
const COLUMNS_STORAGE_KEY = "item-master-columns";

type SavedView = {
  search?: string;
  statusFilter?: string;
  makeFilter?: string;
  categoryFilter?: string;
  skuPrefixFilter?: string;
  supplierFilter?: string;
  rowsPerPage?: number;
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

function loadColumnPrefs(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function skuPrefix(sku: string): string {
  const match = sku.match(/^[A-Za-z]+/);
  return (match ? match[0] : sku.slice(0, 3)).toUpperCase();
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
  const [skuPrefixFilter, setSkuPrefixFilter] = useState(() => loadSavedView().skuPrefixFilter || "");
  const [supplierFilter, setSupplierFilter] = useState(() => loadSavedView().supplierFilter || "");
  const [rowsPerPage, setRowsPerPage] = useState(() => loadSavedView().rowsPerPage || 25);
  const [savedViewFlash, setSavedViewFlash] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    () => new Set(loadColumnPrefs() ?? TOGGLEABLE_COLUMNS.map((c) => c.key))
  );
  const [columnsOpen, setColumnsOpen] = useState(false);

  const [sortKey, setSortKey] = useState<keyof ItemMaster | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDiscountOpen, setBulkDiscountOpen] = useState(false);
  const [bulkDiscountValue, setBulkDiscountValue] = useState("");

  const [page, setPage] = useState(1);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

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
  const distinctSkuPrefixes = useMemo(
    () => Array.from(new Set(items.filter((i) => i.sku).map((i) => skuPrefix(i.sku!)))).sort(),
    [items]
  );
  const distinctSuppliers = useMemo(
    () => Array.from(new Set(items.map((i) => i.supplier).filter((v): v is string => !!v))).sort(),
    [items]
  );

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
      (!skuPrefixFilter || (item.sku && skuPrefix(item.sku) === skuPrefixFilter)) &&
      (!supplierFilter || item.supplier === supplierFilter)
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
        const av = a[sortKey];
        const bv = b[sortKey];
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

  const filterKey = `${search}|${statusFilter}|${makeFilter}|${categoryFilter}|${skuPrefixFilter}|${supplierFilter}|${rowsPerPage}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const hasActiveFilters =
    !!search || statusFilter !== "all" || !!makeFilter || !!categoryFilter || !!skuPrefixFilter || !!supplierFilter;

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setMakeFilter("");
    setCategoryFilter("");
    setSkuPrefixFilter("");
    setSupplierFilter("");
  }

  function saveCurrentView() {
    const view: SavedView = { search, statusFilter, makeFilter, categoryFilter, skuPrefixFilter, supplierFilter, rowsPerPage };
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
    setSavedViewFlash(true);
    setTimeout(() => setSavedViewFlash(false), 1500);
  }

  function toggleColumn(key: string) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  }

  function handleSort(key: keyof ItemMaster) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
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
    const { data } = await supabase.from("item_master").select("*").order("sku");
    setItems((data ?? []) as ItemMaster[]);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    const { error } = await supabase.from("item_master").insert(draftToRow(draft));
    if (error) {
      setError(error.message);
      return;
    }
    setDraft(EMPTY_DRAFT);
    setAdding(false);
    refresh();
  }

  function startEdit(item: ItemMaster) {
    setEditingId(item.id);
    setEditDraft({
      sku: item.sku ?? "",
      vendor_cat: item.vendor_cat ?? "",
      description: item.description,
      make: item.make ?? "",
      category: item.category ?? "",
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
    const { error } = await supabase
      .from("item_master")
      .update({ ...draftToRow(editDraft), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    setEditingId(null);
    refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this item? Feeders that use it will keep referencing it until you also remove it there.")) return;
    const { error } = await supabase.from("item_master").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    refresh();
  }

  async function handleDeleteSelected() {
    if (!confirm(`Delete ${selectedIds.size} item(s)? This can't be undone.`)) return;
    const { error } = await supabase.from("item_master").delete().in("id", Array.from(selectedIds));
    if (error) {
      alert(error.message);
      return;
    }
    setSelectedIds(new Set());
    refresh();
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

  const selectedItems = items.filter((i) => selectedIds.has(i.id));
  const lastUpdatedAt = selectedItems.reduce<string | null>(
    (latest, i) => (!latest || i.updated_at > latest ? i.updated_at : latest),
    null
  );

  const col = (key: string) => visibleColumns.has(key);

  return (
    <div className="space-y-3">
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
            <XlsUpload onDone={refresh} />
            <button
              onClick={() => downloadCsv("item-master-price-list.csv", sorted)}
              className="flex h-8 items-center gap-1.5 rounded-[4px] bg-surface-container-lowest px-2.5 text-xs font-medium text-on-surface shadow-sm hover:bg-surface-container-low"
            >
              <Icon name="download" size={16} className="text-secondary" /> Export Price List
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-[8px] bg-surface-container-lowest p-4 shadow-sm">
        <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-12">
          <div className="relative md:col-span-4">
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
          <FilterSelect
            className="md:col-span-2"
            value={makeFilter}
            onChange={setMakeFilter}
            allLabel="All makes"
            options={distinctMakes}
          />
          <FilterSelect
            className="md:col-span-2"
            value={categoryFilter}
            onChange={setCategoryFilter}
            allLabel="All categories"
            options={distinctCategories}
          />
          <FilterSelect
            className="md:col-span-2"
            value={skuPrefixFilter}
            onChange={setSkuPrefixFilter}
            allLabel="All SKU prefixes"
            options={distinctSkuPrefixes}
          />
          <FilterSelect
            className="md:col-span-2"
            value={supplierFilter}
            onChange={setSupplierFilter}
            allLabel="All suppliers"
            options={distinctSuppliers}
          />
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
              label={STATUS_LABELS.inactive}
              count={counts.inactive}
              active={statusFilter === "inactive"}
              onClick={() => setStatusFilter("inactive")}
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
                <Icon name="view_column" size={14} className="text-secondary" /> Customize Columns ({visibleColumns.size + 5})
              </button>
              {columnsOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-[4px] bg-surface-container-lowest p-2 shadow-md">
                  <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-secondary">
                    Toggle optional columns
                  </p>
                  {TOGGLEABLE_COLUMNS.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 rounded px-1 py-1 text-xs text-on-surface hover:bg-surface-container-low">
                      <input type="checkbox" checked={visibleColumns.has(c.key)} onChange={() => toggleColumn(c.key)} className="rounded" />
                      {c.label}
                    </label>
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
                <SheetSyncButton onDone={refresh} />
                <button
                  onClick={() => setAdding((v) => !v)}
                  className="flex h-8 items-center gap-1.5 rounded-[4px] bg-primary px-3 text-xs font-medium text-on-primary shadow-sm hover:bg-primary-container"
                >
                  <Icon name="add" size={14} /> {adding ? "Cancel" : "Add item"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {adding && (
        <form onSubmit={handleAdd} className="grid grid-cols-2 gap-3 rounded-[8px] bg-surface-container-lowest p-4 shadow-sm sm:grid-cols-4">
          <Field label="SKU" value={draft.sku} onChange={(v) => setDraft({ ...draft, sku: v })} />
          <Field label="Vendor Cat" value={draft.vendor_cat} onChange={(v) => setDraft({ ...draft, vendor_cat: v })} />
          <Field label="Description" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} required className="sm:col-span-2" />
          <Field label="Make" value={draft.make} onChange={(v) => setDraft({ ...draft, make: v })} />
          <Field label="Category" value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} />
          <StatusField value={draft.status} onChange={(v) => setDraft({ ...draft, status: v })} />
          <Field label="Amps" value={draft.amps} onChange={(v) => setDraft({ ...draft, amps: v })} type="number" />
          <Field label="kA" value={draft.ka} onChange={(v) => setDraft({ ...draft, ka: v })} type="number" />
          <Field label="Poles" value={draft.poles} onChange={(v) => setDraft({ ...draft, poles: v })} type="number" />
          <Field label="UOM" value={draft.uom} onChange={(v) => setDraft({ ...draft, uom: v })} />
          <Field label="Unit cost" value={draft.unit_cost} onChange={(v) => setDraft({ ...draft, unit_cost: v })} type="number" />
          <Field label="List price" value={draft.list_price} onChange={(v) => setDraft({ ...draft, list_price: v })} type="number" />
          <Field label="Discount %" value={draft.discount_pct} onChange={(v) => setDraft({ ...draft, discount_pct: v })} type="number" />
          <Field label="Supplier" value={draft.supplier} onChange={(v) => setDraft({ ...draft, supplier: v })} />
          <Field label="Notes" value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} className="sm:col-span-2" />
          <p className="text-xs text-secondary sm:col-span-4">Either SKU or Vendor Cat is required (both are fine too).</p>
          <div className="sm:col-span-4">
            <button type="submit" className="rounded-[4px] bg-primary px-4 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-container">
              Save item
            </button>
          </div>
        </form>
      )}

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
                    type="number"
                    step="0.1"
                    value={bulkDiscountValue}
                    onChange={(e) => setBulkDiscountValue(e.target.value)}
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
              onClick={handleDeleteSelected}
              className="flex items-center gap-1.5 rounded bg-error/90 px-2.5 py-1 text-xs font-medium text-on-error hover:bg-error"
            >
              <Icon name="delete" size={14} /> Delete selected
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
                <SortableTh label="SKU" sortKey="sku" current={sortKey} dir={sortDir} onSort={handleSort} />
                {col("vendor_cat") && <SortableTh label="Vendor Cat" sortKey="vendor_cat" current={sortKey} dir={sortDir} onSort={handleSort} />}
                <SortableTh label="Description" sortKey="description" current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[240px]" />
                {col("category") && <SortableTh label="Category" sortKey="category" current={sortKey} dir={sortDir} onSort={handleSort} />}
                {col("make") && <SortableTh label="Make" sortKey="make" current={sortKey} dir={sortDir} onSort={handleSort} />}
                {col("uom") && <SortableTh label="UOM" sortKey="uom" current={sortKey} dir={sortDir} onSort={handleSort} align="center" />}
                <SortableTh label="Unit Cost" sortKey="unit_cost" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                {col("list_price") && <SortableTh label="List Price" sortKey="list_price" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />}
                {col("discount_pct") && <SortableTh label="Disc %" sortKey="discount_pct" current={sortKey} dir={sortDir} onSort={handleSort} align="center" />}
                {col("amps") && <SortableTh label="Amps" sortKey="amps" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />}
                {col("poles") && <SortableTh label="Poles" sortKey="poles" current={sortKey} dir={sortDir} onSort={handleSort} align="center" />}
                {col("ka") && <SortableTh label="kA" sortKey="ka" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />}
                <SortableTh label="Status" sortKey="status" current={sortKey} dir={sortDir} onSort={handleSort} />
                {isAdmin && <th className="sticky right-0 bg-surface-container px-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {paged.map((item) =>
                editingId === item.id ? (
                  <tr key={item.id} className="bg-tertiary-fixed/40">
                    {isAdmin && <td />}
                    <td className="px-2 py-1"><input className="w-24 rounded border px-1 py-0.5" value={editDraft.sku} onChange={(e) => setEditDraft({ ...editDraft, sku: e.target.value })} /></td>
                    {col("vendor_cat") && <td className="px-2 py-1"><input className="w-24 rounded border px-1 py-0.5" value={editDraft.vendor_cat} onChange={(e) => setEditDraft({ ...editDraft, vendor_cat: e.target.value })} /></td>}
                    <td className="px-2 py-1"><input className="w-full min-w-40 rounded border px-1 py-0.5" value={editDraft.description} onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })} /></td>
                    {col("category") && <td className="px-2 py-1"><input className="w-24 rounded border px-1 py-0.5" value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} /></td>}
                    {col("make") && <td className="px-2 py-1"><input className="w-24 rounded border px-1 py-0.5" value={editDraft.make} onChange={(e) => setEditDraft({ ...editDraft, make: e.target.value })} /></td>}
                    {col("uom") && <td className="px-2 py-1"><input className="w-16 rounded border px-1 py-0.5" value={editDraft.uom} onChange={(e) => setEditDraft({ ...editDraft, uom: e.target.value })} /></td>}
                    <td className="px-2 py-1"><input type="number" className="w-24 rounded border px-1 py-0.5 text-right" value={editDraft.unit_cost} onChange={(e) => setEditDraft({ ...editDraft, unit_cost: e.target.value })} /></td>
                    {col("list_price") && <td className="px-2 py-1"><input type="number" className="w-24 rounded border px-1 py-0.5 text-right" value={editDraft.list_price} onChange={(e) => setEditDraft({ ...editDraft, list_price: e.target.value })} /></td>}
                    {col("discount_pct") && <td className="px-2 py-1"><input type="number" className="w-16 rounded border px-1 py-0.5 text-right" value={editDraft.discount_pct} onChange={(e) => setEditDraft({ ...editDraft, discount_pct: e.target.value })} /></td>}
                    {col("amps") && <td className="px-2 py-1"><input type="number" className="w-16 rounded border px-1 py-0.5 text-right" value={editDraft.amps} onChange={(e) => setEditDraft({ ...editDraft, amps: e.target.value })} /></td>}
                    {col("poles") && <td className="px-2 py-1"><input type="number" className="w-14 rounded border px-1 py-0.5 text-right" value={editDraft.poles} onChange={(e) => setEditDraft({ ...editDraft, poles: e.target.value })} /></td>}
                    {col("ka") && <td className="px-2 py-1"><input type="number" className="w-16 rounded border px-1 py-0.5 text-right" value={editDraft.ka} onChange={(e) => setEditDraft({ ...editDraft, ka: e.target.value })} /></td>}
                    <td className="px-2 py-1">
                      <select className="rounded border px-1 py-0.5" value={editDraft.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value as ItemStatus })}>
                        <option value="active">{STATUS_LABELS.active}</option>
                        <option value="inactive">{STATUS_LABELS.inactive}</option>
                        <option value="discontinued">{STATUS_LABELS.discontinued}</option>
                      </select>
                    </td>
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
                    <td className="px-2 font-display font-semibold text-primary">
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
                    </td>
                    {col("vendor_cat") && <td className="px-2 font-display text-secondary">{item.vendor_cat || "—"}</td>}
                    <td className="max-w-[320px] truncate px-2 text-on-surface" title={item.description}>
                      {item.description}
                    </td>
                    {col("category") && (
                      <td className="px-2">
                        {item.category ? (
                          <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant">{item.category}</span>
                        ) : (
                          <span className="text-outline-variant">—</span>
                        )}
                      </td>
                    )}
                    {col("make") && (
                      <td className="px-2">
                        {item.make ? (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${makeColor(item.make)}`}>{item.make}</span>
                        ) : (
                          <span className="text-outline-variant">—</span>
                        )}
                      </td>
                    )}
                    {col("uom") && <td className="px-2 text-center font-display text-secondary">{item.uom}</td>}
                    <td className="px-2 text-right font-display font-bold tabular-nums text-on-surface">₹{item.unit_cost.toLocaleString("en-IN")}</td>
                    {col("list_price") && (
                      <td className="px-2 text-right font-display tabular-nums text-secondary line-through">
                        {item.list_price != null ? `₹${item.list_price.toLocaleString("en-IN")}` : ""}
                      </td>
                    )}
                    {col("discount_pct") && (
                      <td className="px-2 text-center">
                        {item.discount_pct != null ? (
                          <span className="rounded bg-tertiary-fixed px-1.5 py-0.5 font-display text-[11px] font-bold text-on-tertiary-fixed">
                            -{item.discount_pct}%
                          </span>
                        ) : (
                          <span className="text-outline-variant">—</span>
                        )}
                      </td>
                    )}
                    {col("amps") && <td className="px-2 text-right font-display font-semibold tabular-nums text-on-surface">{item.amps ?? "—"}</td>}
                    {col("poles") && <td className="px-2 text-center font-display tabular-nums text-on-surface">{item.poles ?? "—"}</td>}
                    {col("ka") && <td className="px-2 text-right font-display font-bold tabular-nums text-primary">{item.ka ?? "—"}</td>}
                    <td className="px-2">
                      <StatusBadge status={item.status} />
                    </td>
                    {isAdmin && (
                      <td className="sticky right-0 bg-surface-container-lowest px-2 text-right group-hover:bg-surface-container-low">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => startEdit(item)} title="Edit" className="rounded p-1 text-secondary hover:bg-surface-container hover:text-primary">
                            <Icon name="edit" size={15} />
                          </button>
                          <button
                            onClick={() => alert("No spec sheet uploaded for this item yet.")}
                            title="View Spec PDF"
                            className="rounded p-1 text-secondary hover:bg-surface-container hover:text-tertiary"
                          >
                            <Icon name="picture_as_pdf" size={15} />
                          </button>
                          <button onClick={() => handleDelete(item.id)} title="Delete" className="rounded p-1 text-secondary hover:bg-error-container hover:text-error">
                            <Icon name="delete" size={15} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              )}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={16} className="px-3 py-10 text-center text-sm text-secondary">
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
  sortKey: keyof ItemMaster;
  current: keyof ItemMaster | null;
  dir: "asc" | "desc";
  onSort: (key: keyof ItemMaster) => void;
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

function StatusField({ value, onChange }: { value: ItemStatus; onChange: (v: ItemStatus) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-on-surface-variant">Status</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ItemStatus)}
        className="w-full rounded-[4px] border border-outline-variant/60 px-2 py-1.5 text-sm"
      >
        <option value="active">{STATUS_LABELS.active}</option>
        <option value="inactive">{STATUS_LABELS.inactive}</option>
        <option value="discontinued">{STATUS_LABELS.discontinued}</option>
      </select>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-on-surface-variant">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[4px] border border-outline-variant/60 px-2 py-1.5 text-sm"
      />
    </div>
  );
}
