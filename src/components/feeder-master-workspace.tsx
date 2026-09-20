"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { itemCode } from "@/lib/item-display";
import type { Feeder, FeederItemWithDetails, ItemMaster } from "@/types/database";

const FEEDER_TYPES = ["Incomer", "Outgoing", "APFC Bank", "Bus Coupler", "Riser", "Metering", "Spare"];
const POLE_CONFIGS = ["1P", "2P", "3P", "4P"];

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function netRate(item: ItemMaster) {
  if (item.list_price != null && item.discount_pct != null) {
    return item.list_price * (1 - item.discount_pct / 100);
  }
  return item.unit_cost;
}

function feederCost(lines: FeederItemWithDetails[]) {
  return lines.reduce((s, l) => s + l.qty * netRate(l.item), 0);
}

type FeederFormState = {
  tag: string;
  name: string;
  rated_current: string;
  category: string;
  description: string;
  pole_config: string;
  breaking_capacity: string;
};

function formOf(f: Feeder): FeederFormState {
  return {
    tag: f.tag ?? "",
    name: f.name,
    rated_current: f.rated_current != null ? String(f.rated_current) : "",
    category: f.category ?? "",
    description: f.description ?? "",
    pole_config: f.pole_config ?? "",
    breaking_capacity: f.breaking_capacity ?? "",
  };
}

export function FeederMasterWorkspace({
  initialFeeders,
  initialLinesByFeeder,
  allItems,
  isAdmin,
}: {
  initialFeeders: Feeder[];
  initialLinesByFeeder: Record<string, FeederItemWithDetails[]>;
  allItems: ItemMaster[];
  isAdmin: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [feeders, setFeeders] = useState(initialFeeders);
  const [linesByFeeder, setLinesByFeeder] = useState(initialLinesByFeeder);
  const [typeFilter, setTypeFilter] = useState("ALL");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FeederFormState | null>(null);
  const [savedForm, setSavedForm] = useState<FeederFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [itemSearch, setItemSearch] = useState("");
  const [categoryChip, setCategoryChip] = useState<string | null>(null);
  const [addQty, setAddQty] = useState("1");

  const selectedFeeder = feeders.find((f) => f.id === selectedId) ?? null;
  const selectedLines = selectedId ? linesByFeeder[selectedId] ?? [] : [];
  const dirty = form && savedForm && JSON.stringify(form) !== JSON.stringify(savedForm);

  const typeOptions = Array.from(new Set(feeders.map((f) => f.category).filter((c): c is string => !!c))).sort();
  const filteredFeeders = typeFilter === "ALL" ? feeders : feeders.filter((f) => f.category === typeFilter);

  const itemCategories = Array.from(new Set(allItems.map((i) => i.category).filter((c): c is string => !!c))).sort().slice(0, 6);

  const itemMatches = itemSearch.trim()
    ? allItems
        .filter((i) => {
          if (categoryChip && i.category !== categoryChip) return false;
          const q = itemSearch.toLowerCase();
          return itemCode(i).toLowerCase().includes(q) || i.description.toLowerCase().includes(q);
        })
        .slice(0, 10)
    : categoryChip
      ? allItems.filter((i) => i.category === categoryChip).slice(0, 10)
      : [];

  function selectFeeder(f: Feeder) {
    setSelectedId(f.id);
    const snap = formOf(f);
    setForm(snap);
    setSavedForm(snap);
  }

  async function handleCreate() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("feeders")
      .insert({ name: "New Feeder", is_library: true, created_by: user?.id })
      .select("*")
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    const feeder = data as Feeder;
    setFeeders((prev) => [...prev, feeder]);
    setLinesByFeeder((prev) => ({ ...prev, [feeder.id]: [] }));
    selectFeeder(feeder);
  }

  async function handleClone(f: Feeder) {
    setBusyId(f.id);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: newFeeder, error } = await supabase
      .from("feeders")
      .insert({
        name: `${f.name} (Copy)`,
        description: f.description,
        category: f.category,
        tag: f.tag ? `${f.tag}-COPY` : null,
        rating_summary: f.rating_summary,
        rated_current: f.rated_current,
        pole_config: f.pole_config,
        breaking_capacity: f.breaking_capacity,
        is_library: true,
        created_by: user?.id,
      })
      .select("*")
      .single();
    if (error || !newFeeder) {
      setBusyId(null);
      alert(error?.message ?? "Could not clone feeder.");
      return;
    }
    const sourceLines = linesByFeeder[f.id] ?? [];
    let clonedLines: FeederItemWithDetails[] = [];
    if (sourceLines.length) {
      const { data: insertedLines, error: linesError } = await supabase
        .from("feeder_items")
        .insert(sourceLines.map((l, i) => ({ feeder_id: newFeeder.id, item_id: l.item_id, qty: l.qty, sort_order: i })))
        .select("*, item:item_master(*)");
      if (linesError) {
        setBusyId(null);
        alert(linesError.message);
        return;
      }
      clonedLines = (insertedLines ?? []) as unknown as FeederItemWithDetails[];
    }
    setBusyId(null);
    setFeeders((prev) => [...prev, newFeeder as Feeder]);
    setLinesByFeeder((prev) => ({ ...prev, [newFeeder.id]: clonedLines }));
  }

  async function handleDelete(f: Feeder) {
    if (!confirm(`Delete feeder "${f.name}"? This can't be undone.`)) return;
    setBusyId(f.id);
    const { error } = await supabase.from("feeders").delete().eq("id", f.id);
    setBusyId(null);
    if (error) {
      alert(error.message);
      return;
    }
    setFeeders((prev) => prev.filter((x) => x.id !== f.id));
    setLinesByFeeder((prev) => {
      const next = { ...prev };
      delete next[f.id];
      return next;
    });
    if (selectedId === f.id) {
      setSelectedId(null);
      setForm(null);
      setSavedForm(null);
    }
  }

  function updateField<K extends keyof FeederFormState>(field: K, value: FeederFormState[K]) {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  function resetForm() {
    if (savedForm) setForm(savedForm);
  }

  async function saveFeeder() {
    if (!selectedFeeder || !form) return;
    setSaving(true);
    const patch = {
      tag: form.tag || null,
      name: form.name,
      rated_current: form.rated_current ? Number(form.rated_current) : null,
      category: form.category || null,
      description: form.description || null,
      pole_config: form.pole_config || null,
      breaking_capacity: form.breaking_capacity || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("feeders").update(patch).eq("id", selectedFeeder.id);
    setSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    setFeeders((prev) => prev.map((f) => (f.id === selectedFeeder.id ? { ...f, ...patch } : f)));
    setSavedForm(form);
  }

  async function addLine(item: ItemMaster) {
    if (!selectedId) return;
    const qty = Number(addQty) || 1;
    const sortOrder = (linesByFeeder[selectedId] ?? []).length;
    const { data, error } = await supabase
      .from("feeder_items")
      .insert({ feeder_id: selectedId, item_id: item.id, qty, sort_order: sortOrder })
      .select("*")
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    setLinesByFeeder((prev) => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), { ...(data as FeederItemWithDetails), item }],
    }));
    setItemSearch("");
    setAddQty("1");
  }

  async function updateLineQty(lineId: string, qty: number) {
    if (!selectedId) return;
    setLinesByFeeder((prev) => ({
      ...prev,
      [selectedId]: (prev[selectedId] ?? []).map((l) => (l.id === lineId ? { ...l, qty } : l)),
    }));
    await supabase.from("feeder_items").update({ qty }).eq("id", lineId);
  }

  async function removeLine(lineId: string) {
    if (!selectedId) return;
    setLinesByFeeder((prev) => ({ ...prev, [selectedId]: (prev[selectedId] ?? []).filter((l) => l.id !== lineId) }));
    await supabase.from("feeder_items").delete().eq("id", lineId);
  }

  async function moveLine(lineId: string, direction: -1 | 1) {
    if (!selectedId) return;
    const lines = [...(linesByFeeder[selectedId] ?? [])];
    const idx = lines.findIndex((l) => l.id === lineId);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= lines.length) return;
    [lines[idx], lines[swapIdx]] = [lines[swapIdx], lines[idx]];
    setLinesByFeeder((prev) => ({ ...prev, [selectedId]: lines }));
    await Promise.all([
      supabase.from("feeder_items").update({ sort_order: idx }).eq("id", lines[idx].id),
      supabase.from("feeder_items").update({ sort_order: swapIdx }).eq("id", lines[swapIdx].id),
    ]);
  }

  return (
    <div className="w-full space-y-space-lg p-margin-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <div>
          <p className="font-label-md text-label-md uppercase tracking-wider text-secondary">
            Master Libraries <Icon name="chevron_right" size={12} className="inline" /> Feeder Master{" "}
            <Icon name="chevron_right" size={12} className="inline" /> Template Configurator
          </p>
          <h1 className="font-display text-headline-lg text-on-surface">Feeder Master</h1>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-space-sm">
            <button
              disabled
              title="Import coming soon"
              className="flex items-center gap-1 rounded border border-surface-container-high bg-surface-container-lowest px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant opacity-60"
            >
              <Icon name="upload_file" size={16} /> Import Feeder XLS
            </button>
            <button
              disabled
              title="Export coming soon"
              className="flex items-center gap-1 rounded border border-surface-container-high bg-surface-container-lowest px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant opacity-60"
            >
              <Icon name="file_save" size={16} /> Export Feeder Master
            </button>
            <button
              onClick={handleCreate}
              className="flex items-center gap-1 rounded bg-primary px-space-lg py-space-sm font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary-container"
            >
              <Icon name="add_circle" size={16} /> Create Feeder
            </button>
          </div>
        )}
      </div>

      {/* Standard Feeder Library */}
      <div className="space-y-space-sm">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
            <Icon name="library_books" size={18} className="text-primary" /> Standard Feeder Library
          </h2>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 rounded border border-surface-container-high bg-surface-container-lowest px-space-sm text-body-sm text-on-surface"
          >
            <option value="ALL">All Types ({typeOptions.length})</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="divide-y divide-surface-container rounded-xl bg-surface-container-lowest shadow-sm">
          {filteredFeeders.map((f) => {
            const lines = linesByFeeder[f.id] ?? [];
            const cost = feederCost(lines);
            return (
              <div key={f.id} className="flex flex-wrap items-center justify-between gap-space-md p-space-md">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {f.tag && <span className="font-mono text-xs font-semibold text-on-surface">{f.tag}</span>}
                    {f.category && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                        {f.category}
                      </span>
                    )}
                    {(f.pole_config || f.breaking_capacity) && (
                      <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] font-medium text-on-surface-variant">
                        {[f.pole_config, f.breaking_capacity].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                  <p className="font-headline-sm text-headline-sm text-on-surface">{f.name}</p>
                  {f.description && <p className="font-body-sm text-body-sm text-secondary">{f.description}</p>}
                </div>
                <div className="text-right">
                  <p className="font-body-sm text-body-sm text-secondary">{lines.length} Item{lines.length === 1 ? "" : "s"}</p>
                  <p className="font-headline-sm text-headline-sm text-primary">{money(cost)}</p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => selectFeeder(f)}
                      className="rounded border border-surface-container-high px-space-sm py-1.5 font-label-md text-label-md text-on-surface hover:bg-surface-container-low"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleClone(f)}
                      disabled={busyId === f.id}
                      className="rounded border border-surface-container-high px-space-sm py-1.5 font-label-md text-label-md text-on-surface hover:bg-surface-container-low disabled:opacity-50"
                    >
                      Clone
                    </button>
                    <button
                      disabled
                      title="Open a switchboard's BOM Builder to add this feeder"
                      className="flex items-center gap-1 rounded bg-surface-container-low px-space-sm py-1.5 font-label-md text-label-md text-on-surface-variant opacity-60"
                    >
                      <Icon name="add_box" size={14} /> Use in BOM
                    </button>
                    <button
                      onClick={() => handleDelete(f)}
                      disabled={busyId === f.id}
                      title="Delete feeder"
                      className="rounded p-1.5 text-error hover:bg-error-container disabled:opacity-50"
                    >
                      <Icon name="delete" size={16} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {filteredFeeders.length === 0 && (
            <p className="p-space-lg text-center text-sm text-secondary">
              No feeders yet. {isAdmin ? "Use \"Create Feeder\" above." : "Ask an admin to build the feeder master."}
            </p>
          )}
        </div>
      </div>

      {/* Feeder Attributes */}
      {isAdmin && selectedFeeder && form && (
        <div className="space-y-space-md rounded-xl bg-surface-container-lowest p-space-lg shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <div>
              <h2 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                <Icon name="tune" size={18} className="text-primary" /> Feeder Attributes
              </h2>
              <p className="font-body-sm text-body-sm text-secondary">Define electrical parameters and switchgear specifications</p>
            </div>
            <div className="flex items-center gap-space-sm">
              <button
                onClick={resetForm}
                disabled={!dirty}
                className="rounded border border-surface-container-high px-space-md py-space-sm font-label-md text-label-md text-on-surface hover:bg-surface-container-low disabled:opacity-50"
              >
                Reset Form
              </button>
              <button
                onClick={saveFeeder}
                disabled={saving || !dirty}
                className="flex items-center gap-1 rounded bg-primary px-space-lg py-space-sm font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary-container disabled:opacity-50"
              >
                <Icon name="save" size={16} />
                {saving ? "Saving..." : "Save Feeder to Master"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-space-md sm:grid-cols-3">
            <Field label="Feeder Code">
              <input
                value={form.tag}
                onChange={(e) => updateField("tag", e.target.value)}
                placeholder="FDR-INC-3200-4P"
                className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 font-mono text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
              />
            </Field>
            <Field label="Feeder Name" className="sm:col-span-2">
              <input
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
              />
            </Field>

            <Field label="Feeder Type">
              <select
                value={form.category}
                onChange={(e) => updateField("category", e.target.value)}
                className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Select type...</option>
                {FEEDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                {form.category && !FEEDER_TYPES.includes(form.category) && <option value={form.category}>{form.category}</option>}
              </select>
            </Field>
            <Field label="Feeder Description" className="sm:col-span-2">
              <textarea
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                rows={2}
                className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
              />
            </Field>

            <Field label="Rated Current">
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  value={form.rated_current}
                  onChange={(e) => updateField("rated_current", e.target.value)}
                  className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
                />
                <span className="rounded bg-surface-container-low px-2 py-1.5 font-label-md text-label-md text-on-surface-variant">A</span>
              </div>
            </Field>
            <Field label="Pole Config">
              <select
                value={form.pole_config}
                onChange={(e) => updateField("pole_config", e.target.value)}
                className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">—</option>
                {POLE_CONFIGS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Breaking Capacity">
              <input
                value={form.breaking_capacity}
                onChange={(e) => updateField("breaking_capacity", e.target.value)}
                placeholder="e.g. 65 kA (1s)"
                className="w-full rounded border border-surface-container-high bg-surface-container-lowest px-space-sm py-1.5 text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
              />
            </Field>
          </div>

          {/* Add Item */}
          <div className="space-y-space-sm border-t border-surface-container pt-space-md">
            <div className="flex flex-wrap items-center justify-between gap-space-sm">
              <h3 className="flex items-center gap-2 font-headline-sm text-headline-sm text-on-surface">
                <Icon name="add_box" size={16} className="text-primary" /> Add Item
              </h3>
              <a href="/item-master" className="font-label-md text-label-md text-primary hover:underline">
                Browse Item Master Catalog
              </a>
            </div>
            <div className="relative flex items-center gap-space-sm">
              <div className="relative flex-1">
                <Icon name="search" size={16} className="absolute left-space-sm top-1/2 -translate-y-1/2 text-on-surface-variant" />
                <input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Search Item Master by SKU, description, vendor catalog #, or brand..."
                  className="h-9 w-full rounded border border-surface-container-high bg-surface-container-lowest pl-8 pr-space-sm text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
                className="h-9 w-16 rounded border border-surface-container-high px-space-sm text-right text-body-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-label-sm text-label-sm text-on-surface-variant">Quick Filters:</span>
              <button
                onClick={() => setCategoryChip(null)}
                className={`rounded-full px-space-sm py-1 text-xs font-medium ${categoryChip === null ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"}`}
              >
                All Items
              </button>
              {itemCategories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoryChip(c)}
                  className={`rounded-full px-space-sm py-1 text-xs font-medium ${categoryChip === c ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"}`}
                >
                  {c}
                </button>
              ))}
            </div>
            {itemMatches.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded border border-surface-container-high">
                {itemMatches.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addLine(item)}
                    className="flex w-full items-center justify-between gap-space-sm border-b border-surface-container px-space-sm py-1.5 text-left last:border-b-0 hover:bg-surface-container-low"
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-xs font-semibold text-primary">{itemCode(item)}</span>{" "}
                      <span className="text-body-sm text-on-surface">{item.description}</span>
                    </span>
                    <span className="shrink-0 font-body-sm text-body-sm text-secondary">{money(netRate(item))}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Line items */}
          <div className="overflow-hidden rounded border border-surface-container-high">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-container-low font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                <tr>
                  <th className="w-8 px-2 py-2">#</th>
                  <th className="px-2 py-2">SKU</th>
                  <th className="px-2 py-2">Vendor Cat</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">List Price</th>
                  <th className="px-2 py-2 text-right">Disc %</th>
                  <th className="px-2 py-2 text-right">Net Rate</th>
                  <th className="px-2 py-2">UOM</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="w-16 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {selectedLines.map((line, i) => (
                  <tr key={line.id} className="hover:bg-surface-container-low">
                    <td className="px-2 py-1.5 text-on-surface-variant">{i + 1}</td>
                    <td className="px-2 py-1.5 font-mono font-semibold text-primary">{itemCode(line.item)}</td>
                    <td className="px-2 py-1.5 text-on-surface-variant">{line.item.supplier || "—"}</td>
                    <td className="px-2 py-1.5 text-on-surface">{line.item.description}</td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.qty}
                        onChange={(e) => updateLineQty(line.id, Number(e.target.value) || 0)}
                        className="w-14 rounded border border-surface-container-high px-1 py-0.5 text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-secondary">
                      {line.item.list_price != null ? money(line.item.list_price) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-tertiary">
                      {line.item.discount_pct != null ? `${line.item.discount_pct}%` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-on-surface-variant">{money(netRate(line.item))}</td>
                    <td className="px-2 py-1.5 text-on-surface-variant">{line.item.uom}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-on-surface">{money(line.qty * netRate(line.item))}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <button onClick={() => moveLine(line.id, -1)} disabled={i === 0} className="rounded p-0.5 text-on-surface-variant hover:bg-surface-container-high disabled:opacity-30">
                          <Icon name="arrow_upward" size={13} />
                        </button>
                        <button onClick={() => moveLine(line.id, 1)} disabled={i === selectedLines.length - 1} className="rounded p-0.5 text-on-surface-variant hover:bg-surface-container-high disabled:opacity-30">
                          <Icon name="arrow_downward" size={13} />
                        </button>
                        <button onClick={() => removeLine(line.id)} className="rounded p-0.5 text-error hover:bg-error-container">
                          <Icon name="close" size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {selectedLines.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-2 py-6 text-center text-secondary">
                      No items yet. Search above to add one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</label>
      {children}
    </div>
  );
}
