"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ItemMaster } from "@/types/database";
import { XlsUpload } from "@/components/xls-upload";
import { SheetSyncButton } from "@/components/sheet-sync-button";
import { Icon } from "@/components/icon";

const EMPTY_DRAFT = {
  item_code: "",
  description: "",
  category: "",
  uom: "nos",
  unit_cost: "0",
  supplier: "",
  notes: "",
};

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
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    return (
      item.item_code.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      (item.category ?? "").toLowerCase().includes(q)
    );
  });

  async function refresh() {
    const { data } = await supabase.from("item_master").select("*").order("item_code");
    setItems((data ?? []) as ItemMaster[]);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from("item_master").insert({
      item_code: draft.item_code,
      description: draft.description,
      category: draft.category || null,
      uom: draft.uom || "nos",
      unit_cost: Number(draft.unit_cost) || 0,
      supplier: draft.supplier || null,
      notes: draft.notes || null,
    });
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
      item_code: item.item_code,
      description: item.description,
      category: item.category ?? "",
      uom: item.uom,
      unit_cost: String(item.unit_cost),
      supplier: item.supplier ?? "",
      notes: item.notes ?? "",
    });
  }

  async function saveEdit(id: string) {
    setError(null);
    const { error } = await supabase
      .from("item_master")
      .update({
        item_code: editDraft.item_code,
        description: editDraft.description,
        category: editDraft.category || null,
        uom: editDraft.uom || "nos",
        unit_cost: Number(editDraft.unit_cost) || 0,
        supplier: editDraft.supplier || null,
        notes: editDraft.notes || null,
        updated_at: new Date().toISOString(),
      })
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
            placeholder="Search by code, description, category..."
            className="w-72 rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
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
          <Field label="Item code" value={draft.item_code} onChange={(v) => setDraft({ ...draft, item_code: v })} required />
          <Field label="Description" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} required className="sm:col-span-2" />
          <Field label="Category" value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} />
          <Field label="UOM" value={draft.uom} onChange={(v) => setDraft({ ...draft, uom: v })} />
          <Field label="Unit cost" value={draft.unit_cost} onChange={(v) => setDraft({ ...draft, unit_cost: v })} type="number" />
          <Field label="Supplier" value={draft.supplier} onChange={(v) => setDraft({ ...draft, supplier: v })} />
          <Field label="Notes" value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} />
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
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">UOM</th>
              <th className="px-3 py-2 text-right">Unit cost</th>
              <th className="px-3 py-2">Supplier</th>
              {isAdmin && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) =>
              editingId === item.id ? (
                <tr key={item.id} className="border-t border-slate-100 bg-amber-50">
                  <td className="px-2 py-1"><input className="w-24 rounded border px-1 py-0.5" value={editDraft.item_code} onChange={(e) => setEditDraft({ ...editDraft, item_code: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="w-full rounded border px-1 py-0.5" value={editDraft.description} onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="w-28 rounded border px-1 py-0.5" value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="w-16 rounded border px-1 py-0.5" value={editDraft.uom} onChange={(e) => setEditDraft({ ...editDraft, uom: e.target.value })} /></td>
                  <td className="px-2 py-1"><input type="number" className="w-24 rounded border px-1 py-0.5 text-right" value={editDraft.unit_cost} onChange={(e) => setEditDraft({ ...editDraft, unit_cost: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="w-28 rounded border px-1 py-0.5" value={editDraft.supplier} onChange={(e) => setEditDraft({ ...editDraft, supplier: e.target.value })} /></td>
                  <td className="whitespace-nowrap px-2 py-1">
                    <button onClick={() => saveEdit(item.id)} className="mr-2 text-xs font-medium text-emerald-600 hover:underline">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-slate-500 hover:underline">Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">{item.item_code}</td>
                  <td className="px-3 py-2">{item.description}</td>
                  <td className="px-3 py-2 text-slate-500">{item.category || "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{item.uom}</td>
                  <td className="px-3 py-2 text-right tabular-nums">₹{item.unit_cost.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-slate-500">{item.supplier || "—"}</td>
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
                <td colSpan={isAdmin ? 7 : 6} className="px-3 py-8 text-center text-slate-400">
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
