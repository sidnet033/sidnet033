"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { SavingOverlay } from "@/components/saving-overlay";
import { numericKeyGuard } from "@/lib/numeric-input";
import { itemCode, findDuplicateItem } from "@/lib/item-display";
import type { ItemMaster, ItemSource, ItemStatus } from "@/types/database";

const EMPTY_DRAFT = {
  sku: "",
  vendor_cat: "",
  description: "",
  make: "",
  category: "",
  source: "" as ItemSource | "",
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

function validateDraft(d: Draft): string | null {
  if (!d.sku.trim() && !d.vendor_cat.trim()) return "Either SKU or Vendor Cat is required.";
  if (!d.description.trim()) return "Description is required.";
  if (!d.source) return "Source is required.";
  return null;
}

function draftToRow(d: Draft) {
  return {
    sku: d.sku.trim() || null,
    vendor_cat: d.vendor_cat.trim() || null,
    description: d.description.trim(),
    make: d.make.trim() || null,
    category: d.category.trim() || null,
    source: d.source as ItemSource,
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

// Shared "create a new item" modal -- used from Item Master's "+Add item"
// button and from Feeder Master's "+Create new item in master" button, so
// a new item can always be created the same way no matter where the need
// for one comes up.
export function CreateItemDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: ItemMaster) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  // Items without a SKU are almost always ones raised during estimation
  // (a Design-catalog item normally has one) -- so default Source to
  // Estimation whenever the SKU is blank, unless the user has actively
  // picked a source themselves.
  const effectiveSource: ItemSource | "" = draft.source || (draft.sku.trim() ? "" : "Estimation");

  function handleClose() {
    setDraft(EMPTY_DRAFT);
    setError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const resolved: Draft = { ...draft, source: effectiveSource };
    const validationError = validateDraft(resolved);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    const supabase = createClient();

    const dup = await findDuplicateItem(supabase, { sku: resolved.sku, vendor_cat: resolved.vendor_cat });
    if (dup) {
      setSaving(false);
      const matchedOn = resolved.sku.trim() && dup.sku === resolved.sku.trim() ? "SKU" : "Vendor Cat";
      setError(`An item with this ${matchedOn} already exists: ${itemCode(dup)} — ${dup.description}. Use that item instead of creating a duplicate.`);
      return;
    }

    const { data, error } = await supabase.from("item_master").insert(draftToRow(resolved)).select("*").single();
    setSaving(false);
    if (error || !data) {
      setError(error?.message ?? "Could not create item.");
      return;
    }
    onCreated(data as ItemMaster);
    setDraft(EMPTY_DRAFT);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4 backdrop-blur-sm" onClick={handleClose}>
      <SavingOverlay show={saving} label="Creating item..." />
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[8px] bg-surface-container-lowest shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-outline-variant/30 p-4">
          <h2 className="font-display text-base font-semibold text-on-surface">Create New Item</h2>
          <button onClick={handleClose} className="rounded p-1 text-secondary hover:bg-surface-container-low hover:text-on-surface">
            <Icon name="close" size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="SKU" value={draft.sku} onChange={(v) => patch({ sku: v })} />
            <Field label="Vendor Cat" value={draft.vendor_cat} onChange={(v) => patch({ vendor_cat: v })} />
            <Field label="Description" value={draft.description} onChange={(v) => patch({ description: v })} required className="sm:col-span-2" />
            <Field label="Make" value={draft.make} onChange={(v) => patch({ make: v })} />
            <Field label="Category" value={draft.category} onChange={(v) => patch({ category: v })} />
            <SourceField value={effectiveSource} onChange={(v) => patch({ source: v })} />
            <StatusField value={draft.status} onChange={(v) => patch({ status: v })} />
            <Field label="Amps" value={draft.amps} onChange={(v) => patch({ amps: v })} numeric />
            <Field label="kA" value={draft.ka} onChange={(v) => patch({ ka: v })} numeric />
            <Field label="Poles" value={draft.poles} onChange={(v) => patch({ poles: v })} numeric />
            <Field label="UOM" value={draft.uom} onChange={(v) => patch({ uom: v })} />
            <Field label="Unit cost" value={draft.unit_cost} onChange={(v) => patch({ unit_cost: v })} numeric />
            <Field label="List price" value={draft.list_price} onChange={(v) => patch({ list_price: v })} numeric />
            <Field label="Discount %" value={draft.discount_pct} onChange={(v) => patch({ discount_pct: v })} numeric />
            <Field label="Supplier" value={draft.supplier} onChange={(v) => patch({ supplier: v })} />
            <Field label="Notes" value={draft.notes} onChange={(v) => patch({ notes: v })} className="sm:col-span-2" />
          </div>
          <p className="mt-3 text-xs text-secondary">Either SKU or Vendor Cat is required (both are fine too). Source is required.</p>
          {error && <p className="mt-2 text-sm text-error">{error}</p>}
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-outline-variant/30 pt-3">
            <button type="button" onClick={handleClose} className="rounded-[4px] px-3 py-1.5 text-sm font-medium text-secondary hover:bg-surface-container-low">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-[4px] bg-primary px-4 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-container disabled:opacity-50">
              {saving ? "Creating..." : "Create item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SourceField({ value, onChange }: { value: ItemSource | ""; onChange: (v: ItemSource) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-on-surface-variant">
        Source <span className="text-error">*</span>
      </label>
      <select
        required
        value={value}
        onChange={(e) => onChange(e.target.value as ItemSource)}
        className="w-full rounded-[4px] border border-outline-variant/60 px-2 py-1.5 text-sm"
      >
        <option value="" disabled>
          Select source...
        </option>
        <option value="Design">Design</option>
        <option value="Estimation">Estimation</option>
      </select>
    </div>
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
        <option value="active">Active</option>
        <option value="inactive">Pending Review</option>
        <option value="discontinued">Archived</option>
      </select>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  numeric = false,
  required = false,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-on-surface-variant">{label}</label>
      <input
        type={numeric ? "text" : "text"}
        inputMode={numeric ? "decimal" : undefined}
        onKeyDown={numeric ? numericKeyGuard() : undefined}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[4px] border border-outline-variant/60 px-2 py-1.5 text-sm"
      />
    </div>
  );
}
