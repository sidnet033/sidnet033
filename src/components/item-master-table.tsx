"use client";

import { useMemo, useState } from "react";
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

export function ItemMasterTable({
  initialItems,
  isAdmin,
  initialSearch = "",
}: {
  initialItems: ItemMaster[];
  isAdmin: boolean;
  initialSearch?: string;
}) {
  const [items, setItems] = useState<ItemMaster[]>(initialItems);
  const [search, setSearch] = useState(initialSearch);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    return (
      (item.sku ?? "").toLowerCase().includes(q) ||
      (item.vendor_cat ?? "").toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      (item.make ?? "").toLowerCase().includes(q) ||
      (item.category ?? "").toLowerCase().includes(q)
    );
  });

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by SKU, vendor cat, description, make..."
            className="w-80 rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <a
              href="/templates/item-master-template.xlsx"
              download
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download template
            </a>
            <XlsUpload onDone={refresh} />
            <SheetSyncButton onDone={refresh} />
            <button
              onClick={() => setAdding((v) => !v)}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              {adding ? "Cancel" : "+ Add item"}
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {adding && (
        <form onSubmit={handleAdd} className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs sm:grid-cols-4">
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
          <p className="text-xs text-slate-400 sm:col-span-4">Either SKU or Vendor Cat is required (both are fine too).</p>
          <div className="sm:col-span-4">
            <button type="submit" className="rounded-md bg-brand-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-600">
              Save item
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Vendor Cat</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Make</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Amps</th>
              <th className="px-3 py-2 text-right">kA</th>
              <th className="px-3 py-2 text-right">Poles</th>
              <th className="px-3 py-2">UOM</th>
              <th className="px-3 py-2 text-right">Unit cost</th>
              <th className="px-3 py-2 text-right">List price</th>
              <th className="px-3 py-2 text-right">Disc %</th>
              {isAdmin && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) =>
              editingId === item.id ? (
                <tr key={item.id} className="border-t border-slate-100 bg-amber-50">
                  <td className="px-2 py-1"><input className="w-24 rounded border px-1 py-0.5" value={editDraft.sku} onChange={(e) => setEditDraft({ ...editDraft, sku: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="w-24 rounded border px-1 py-0.5" value={editDraft.vendor_cat} onChange={(e) => setEditDraft({ ...editDraft, vendor_cat: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="w-full min-w-40 rounded border px-1 py-0.5" value={editDraft.description} onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="w-24 rounded border px-1 py-0.5" value={editDraft.make} onChange={(e) => setEditDraft({ ...editDraft, make: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="w-24 rounded border px-1 py-0.5" value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} /></td>
                  <td className="px-2 py-1">
                    <select className="rounded border px-1 py-0.5" value={editDraft.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value as ItemStatus })}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="discontinued">Discontinued</option>
                    </select>
                  </td>
                  <td className="px-2 py-1"><input type="number" className="w-16 rounded border px-1 py-0.5 text-right" value={editDraft.amps} onChange={(e) => setEditDraft({ ...editDraft, amps: e.target.value })} /></td>
                  <td className="px-2 py-1"><input type="number" className="w-16 rounded border px-1 py-0.5 text-right" value={editDraft.ka} onChange={(e) => setEditDraft({ ...editDraft, ka: e.target.value })} /></td>
                  <td className="px-2 py-1"><input type="number" className="w-14 rounded border px-1 py-0.5 text-right" value={editDraft.poles} onChange={(e) => setEditDraft({ ...editDraft, poles: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="w-16 rounded border px-1 py-0.5" value={editDraft.uom} onChange={(e) => setEditDraft({ ...editDraft, uom: e.target.value })} /></td>
                  <td className="px-2 py-1"><input type="number" className="w-24 rounded border px-1 py-0.5 text-right" value={editDraft.unit_cost} onChange={(e) => setEditDraft({ ...editDraft, unit_cost: e.target.value })} /></td>
                  <td className="px-2 py-1"><input type="number" className="w-24 rounded border px-1 py-0.5 text-right" value={editDraft.list_price} onChange={(e) => setEditDraft({ ...editDraft, list_price: e.target.value })} /></td>
                  <td className="px-2 py-1"><input type="number" className="w-16 rounded border px-1 py-0.5 text-right" value={editDraft.discount_pct} onChange={(e) => setEditDraft({ ...editDraft, discount_pct: e.target.value })} /></td>
                  <td className="whitespace-nowrap px-2 py-1">
                    <button onClick={() => saveEdit(item.id)} className="mr-2 text-xs font-medium text-emerald-600 hover:underline">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-slate-500 hover:underline">Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">{item.sku || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{item.vendor_cat || "—"}</td>
                  <td className="px-3 py-2">{item.description}</td>
                  <td className="px-3 py-2 text-slate-500">{item.make || "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{item.category || "—"}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{item.amps ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{item.ka ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{item.poles ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{item.uom}</td>
                  <td className="px-3 py-2 text-right tabular-nums">₹{item.unit_cost.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {item.list_price != null ? `₹${item.list_price.toLocaleString("en-IN")}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {item.discount_pct != null ? `${item.discount_pct}%` : "—"}
                  </td>
                  {isAdmin && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button onClick={() => startEdit(item)} className="mr-2 text-xs text-slate-500 hover:underline">Edit</button>
                      <button onClick={() => handleDelete(item.id)} className="text-xs text-rose-600 hover:underline">Delete</button>
                    </td>
                  )}
                </tr>
              )
            )}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 14 : 13} className="px-3 py-8 text-center text-slate-400">
                  No items found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ItemStatus }) {
  const styles: Record<ItemStatus, string> = {
    active: "bg-emerald-50 text-emerald-600 border-emerald-200/60",
    inactive: "bg-slate-100 text-slate-600 border-slate-200",
    discontinued: "bg-rose-50 text-rose-600 border-rose-200/60",
  };
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function StatusField({ value, onChange }: { value: ItemStatus; onChange: (v: ItemStatus) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ItemStatus)}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="discontinued">Discontinued</option>
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
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
    </div>
  );
}
