"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { itemCode } from "@/lib/item-display";
import { effectiveNetRate } from "@/lib/feeder-cost";
import { computeFeederTag } from "@/lib/feeder-tag";
import type { Feeder, FeederItemWithDetails, ItemMaster } from "@/types/database";

const FEEDER_TYPES = ["Incomer", "Outgoing", "Bus Coupler", "Sub-Incomer", "APFC Capacitor Bank"];
const POLE_CONFIGS = ["3-Pole (3P)", "4-Pole (4P)", "3P + N", "2-Pole (2P)"];
const BREAKING_CAPACITIES = ["65 kA (1s)", "50 kA (1s)", "36 kA (1s)", "25 kA (1s)", "100 kA (1s)"];

function money(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function netRate(item: ItemMaster) {
  return effectiveNetRate(item);
}

// A feeder placed in a switchboard's BOM may have edited a line's price
// there (see bom-builder.tsx) — that override sticks even when the same
// feeder is viewed here in the library.
function lineNetRate(line: FeederItemWithDetails) {
  return effectiveNetRate(line.item, line.list_price_override, line.discount_pct_override);
}

function feederCost(lines: FeederItemWithDetails[]) {
  return lines.reduce((s, l) => s + l.qty * lineNetRate(l), 0);
}

type FeederFormState = {
  name: string;
  rated_current: string;
  category: string;
  description: string;
  pole_config: string;
  breaking_capacity: string;
};

function formOf(f: Feeder): FeederFormState {
  return {
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FeederFormState | null>(null);
  const [savedForm, setSavedForm] = useState<FeederFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [itemSearch, setItemSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<ItemMaster | null>(null);
  const [categoryChip, setCategoryChip] = useState<string | null>(null);

  const selectedFeeder = feeders.find((f) => f.id === selectedId) ?? null;
  const selectedLines = selectedId ? linesByFeeder[selectedId] ?? [] : [];
  const dirty = form && savedForm && JSON.stringify(form) !== JSON.stringify(savedForm);
  const displayedTag = form ? computeFeederTag(form.category, form.rated_current, selectedLines[0]?.item.make ?? null, feeders, selectedId) : "";

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
    : [];

  function selectFeeder(f: Feeder) {
    setSelectedId(f.id);
    const snap = formOf(f);
    setForm(snap);
    setSavedForm(snap);
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
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
      tag: displayedTag,
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

  async function addSelectedItem() {
    if (!selectedId || !selectedItem) return;
    const sortOrder = (linesByFeeder[selectedId] ?? []).length;
    const { data, error } = await supabase
      .from("feeder_items")
      .insert({ feeder_id: selectedId, item_id: selectedItem.id, qty: 1, sort_order: sortOrder })
      .select("*")
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    setLinesByFeeder((prev) => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), { ...(data as FeederItemWithDetails), item: selectedItem }],
    }));
    setItemSearch("");
    setSelectedItem(null);
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
    <div className="w-full bg-surface px-gutter-lg py-gutter">
      <div className="flex flex-col gap-space-lg pb-space-2xl">
        {/* Top context & actions bar */}
        <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-center">
          <div className="flex flex-col">
            <div className="mb-space-2xs flex items-center gap-space-xs font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
              <span>Master Libraries</span>
              <Icon name="chevron_right" size={13} />
              <span className="font-medium text-primary">Feeder Master</span>
              <Icon name="chevron_right" size={13} />
              <span>Template Configurator</span>
            </div>
            <h1 className="font-headline-lg text-headline-lg leading-none tracking-tight text-on-surface">Feeder Master</h1>
          </div>
          {isAdmin && (
            <div className="flex shrink-0 items-center gap-space-sm self-start md:self-auto">
              <button
                disabled
                title="Import coming soon"
                className="flex cursor-not-allowed items-center gap-space-xs rounded bg-surface-container-lowest px-space-md py-space-sm font-body-md text-body-md text-on-surface shadow-sm"
              >
                <Icon name="input" size={18} /> Import Feeder XLS
              </button>
              <button
                disabled
                title="Export coming soon"
                className="flex cursor-not-allowed items-center gap-space-xs rounded bg-surface-container-lowest px-space-md py-space-sm font-body-md text-body-md text-on-surface shadow-sm"
              >
                <Icon name="file_download" size={18} /> Export Feeder Master
              </button>
              <button
                onClick={handleCreate}
                className="flex items-center gap-space-xs rounded bg-primary px-space-md py-space-sm font-body-md text-body-md text-on-primary shadow-sm transition-colors hover:bg-primary-container"
              >
                <Icon name="add_circle" size={18} />
                <span className="font-medium">+ Create Feeder</span>
              </button>
            </div>
          )}
        </div>

        {/* Standard Feeder Library */}
        <section className="flex flex-col gap-space-md">
          <div className="flex flex-col justify-between gap-space-sm md:flex-row md:items-center">
            <div className="flex items-center gap-space-sm">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary">
                <Icon name="folder_copy" size={16} />
              </div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface">Standard Feeder Library</h2>
            </div>
            <div className="flex items-center gap-space-2xs rounded bg-surface-container-lowest px-space-sm py-space-2xs shadow-sm">
              <span className="font-label-sm text-label-sm text-on-surface-variant">Filter Type:</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="cursor-pointer bg-transparent font-label-sm text-label-sm text-on-surface focus:outline-none"
              >
                <option value="ALL">All Types ({typeOptions.length})</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t} ({feeders.filter((f) => f.category === t).length})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-space-sm">
            {filteredFeeders.map((f) => {
              const lines = linesByFeeder[f.id] ?? [];
              const cost = feederCost(lines);
              const expanded = expandedId === f.id;
              return (
                <div key={f.id} className="overflow-hidden rounded bg-surface-container-lowest shadow-sm transition-colors">
                  <div
                    onClick={() => toggleExpand(f.id)}
                    className="flex cursor-pointer flex-col justify-between gap-space-md p-space-md transition-colors hover:bg-surface-container-low/40 md:flex-row md:items-center"
                  >
                    <div className="flex items-start gap-space-md md:items-center">
                      <Icon name={expanded ? "expand_more" : "chevron_right"} size={18} className="mt-1 shrink-0 text-on-surface-variant md:mt-0" />
                      <div className="flex flex-col">
                        <div className="flex flex-wrap items-center gap-space-sm">
                          <span className="font-telemetry-md text-telemetry-md font-bold text-on-surface">{f.tag || "—"}</span>
                          {f.category && (
                            <span className="rounded bg-surface-container-high px-space-xs py-space-2xs font-label-sm text-label-sm font-semibold text-primary">
                              {f.category.toUpperCase()}
                            </span>
                          )}
                          {(f.pole_config || f.breaking_capacity) && (
                            <span className="rounded bg-surface-container px-space-xs py-space-2xs font-label-sm text-label-sm text-on-surface-variant">
                              {[f.pole_config, f.breaking_capacity].filter(Boolean).join(" • ")}
                            </span>
                          )}
                        </div>
                        <span className="mt-space-2xs font-body-md text-body-md text-on-surface">{f.name}</span>
                        {f.description && <span className="font-label-sm text-label-sm text-on-surface-variant">{f.description}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-space-lg md:justify-end">
                      <div className="flex flex-col md:items-end">
                        <span className="font-label-sm text-label-sm text-on-surface-variant">
                          {lines.length} Item{lines.length === 1 ? "" : "s"}
                        </span>
                        <span className="font-telemetry-md text-telemetry-md font-bold text-primary">{money(cost)}</span>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-space-xs" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => selectFeeder(f)}
                            className="rounded bg-surface-container-low px-space-sm py-space-xs font-label-md text-label-md text-on-surface shadow-sm transition-colors hover:bg-surface-container"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleClone(f)}
                            disabled={busyId === f.id}
                            title="Clone as new template"
                            className="rounded bg-surface-container-low px-space-sm py-space-xs font-label-md text-label-md text-on-surface shadow-sm transition-colors hover:bg-surface-container disabled:opacity-50"
                          >
                            Clone
                          </button>
                          <button
                            disabled
                            title="Open a switchboard's BOM Builder to add this feeder"
                            className="flex cursor-not-allowed items-center gap-1 rounded bg-primary px-space-sm py-space-xs font-label-md text-label-md font-medium text-on-primary opacity-60 shadow-sm"
                          >
                            <Icon name="add_box" size={14} /> Use in BOM
                          </button>
                          <button
                            onClick={() => handleDelete(f)}
                            disabled={busyId === f.id}
                            title="Delete feeder"
                            className="rounded p-1.5 text-error hover:bg-error-container disabled:opacity-50"
                          >
                            <Icon name="delete" size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-surface-container-high">
                      {lines.length === 0 ? (
                        <p className="p-space-md text-center font-body-sm text-body-sm text-secondary">No items in this feeder yet.</p>
                      ) : (
                        <table className="w-full text-left">
                          <thead>
                            <tr className="bg-surface-container-low font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                              <th className="py-space-xs pl-space-lg pr-space-xs">SKU</th>
                              <th className="px-space-sm py-space-xs">Make</th>
                              <th className="px-space-sm py-space-xs">Category</th>
                              <th className="px-space-sm py-space-xs">Description</th>
                              <th className="px-space-sm py-space-xs text-center">Qty</th>
                              <th className="px-space-sm py-space-xs text-right">Net Rate</th>
                              <th className="py-space-xs pr-space-lg pl-space-xs text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="font-body-sm text-body-sm text-on-surface">
                            {lines.map((line) => (
                              <tr key={line.id} className="border-t border-surface-container">
                                <td className="py-space-xs pl-space-lg pr-space-xs font-telemetry-md font-bold text-primary">{itemCode(line.item)}</td>
                                <td className="px-space-sm py-space-xs text-on-surface-variant">{line.item.make || "—"}</td>
                                <td className="px-space-sm py-space-xs text-on-surface-variant">{line.item.category || "—"}</td>
                                <td className="px-space-sm py-space-xs">{line.item.description}</td>
                                <td className="px-space-sm py-space-xs text-center tabular-nums">{line.qty}</td>
                                <td className="px-space-sm py-space-xs text-right tabular-nums">{money(lineNetRate(line))}</td>
                                <td className="py-space-xs pr-space-lg pl-space-xs text-right font-semibold tabular-nums">
                                  {money(line.qty * lineNetRate(line))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredFeeders.length === 0 && (
              <div className="rounded bg-surface-container-lowest p-space-lg text-center text-sm text-secondary shadow-sm">
                No feeders yet. {isAdmin ? 'Use "+ Create Feeder" above.' : "Ask an admin to build the feeder master."}
              </div>
            )}
          </div>
        </section>

        {isAdmin && selectedFeeder && form && (
          <>
            {/* Section 1: Feeder Attributes */}
            <section className="flex flex-col gap-space-md rounded bg-surface-container-lowest p-space-lg shadow-sm">
              <div className="flex flex-col justify-between gap-space-sm border-b border-surface-container-high pb-space-sm md:flex-row md:items-center">
                <div className="flex items-center gap-space-sm">
                  <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 text-primary">
                    <Icon name="tune" size={18} />
                  </div>
                  <div className="flex flex-col">
                    <h2 className="font-headline-sm text-headline-sm leading-tight text-on-surface">Feeder Attributes</h2>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Define electrical parameters and switchgear specifications</span>
                  </div>
                </div>
                <div className="flex items-center gap-space-sm">
                  <button
                    onClick={resetForm}
                    disabled={!dirty}
                    type="button"
                    className="rounded border border-outline-variant bg-surface-container-lowest px-space-md py-space-xs font-body-sm text-body-sm font-medium text-on-surface-variant shadow-sm transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-50"
                  >
                    Reset Form
                  </button>
                  <button
                    onClick={saveFeeder}
                    disabled={saving || !dirty}
                    type="button"
                    className="flex items-center gap-space-xs rounded bg-primary px-space-md py-space-xs font-body-sm text-body-sm font-medium text-on-primary shadow-sm transition-colors hover:bg-primary-container disabled:opacity-50"
                  >
                    <Icon name="save" size={16} />
                    {saving ? "Saving..." : "Save Feeder to Master"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 items-start gap-space-lg pt-space-xs md:grid-cols-3">
                <div className="flex flex-col gap-space-md">
                  <FormField label="Feeder Code">
                    <div
                      title="Auto-generated from Feeder Type, Rated Current and the first item's make"
                      className="flex h-9 items-center rounded border border-outline-variant bg-surface-container-low px-space-sm font-telemetry-md text-telemetry-md text-on-surface-variant"
                    >
                      {displayedTag}
                    </div>
                  </FormField>
                  <FormField label="Feeder Type">
                    <div className="relative flex items-center">
                      <select
                        value={form.category}
                        onChange={(e) => updateField("category", e.target.value)}
                        className="h-9 w-full appearance-none rounded border border-outline-variant bg-surface-container-lowest pl-space-sm pr-8 font-body-md text-body-md text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select type...</option>
                        {FEEDER_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                        {form.category && !FEEDER_TYPES.includes(form.category) && <option value={form.category}>{form.category}</option>}
                      </select>
                      <Icon name="expand_more" size={18} className="pointer-events-none absolute right-space-sm text-on-surface-variant" />
                    </div>
                  </FormField>
                </div>

                <div className="flex flex-col gap-space-md">
                  <FormField label="Feeder Name">
                    <input
                      value={form.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      className="h-9 rounded border border-outline-variant bg-surface-container-lowest px-space-sm font-body-md text-body-md text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </FormField>
                  <FormField label="Feeder Description">
                    <textarea
                      value={form.description}
                      onChange={(e) => updateField("description", e.target.value)}
                      rows={3}
                      placeholder="Engineering specification details..."
                      className="w-full resize-none rounded border border-outline-variant bg-surface-container-lowest p-space-sm font-body-sm text-body-sm text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </FormField>
                </div>

                <div className="flex flex-col gap-space-md">
                  <FormField label="Rated Current">
                    <div className="relative flex items-center">
                      <input
                        type="number"
                        min="0"
                        value={form.rated_current}
                        onChange={(e) => updateField("rated_current", e.target.value)}
                        className="h-9 w-full rounded border border-outline-variant bg-surface-container-lowest pl-space-sm pr-10 text-right font-telemetry-md text-telemetry-md text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <span className="pointer-events-none absolute right-0 top-0 bottom-0 flex items-center rounded-r border-l border-outline-variant bg-surface-container-low px-space-sm font-telemetry-md text-telemetry-md font-bold text-on-surface-variant">
                        A
                      </span>
                    </div>
                  </FormField>
                  <div className="grid grid-cols-2 gap-space-sm">
                    <FormField label="Pole Config">
                      <div className="relative flex items-center">
                        <select
                          value={form.pole_config}
                          onChange={(e) => updateField("pole_config", e.target.value)}
                          className="h-9 w-full appearance-none rounded border border-outline-variant bg-surface-container-lowest pl-space-sm pr-7 font-body-md text-body-md text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">—</option>
                          {POLE_CONFIGS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                          {form.pole_config && !POLE_CONFIGS.includes(form.pole_config) && <option value={form.pole_config}>{form.pole_config}</option>}
                        </select>
                        <Icon name="expand_more" size={16} className="pointer-events-none absolute right-space-xs text-on-surface-variant" />
                      </div>
                    </FormField>
                    <FormField label="Breaking Capacity">
                      <div className="relative flex items-center">
                        <select
                          value={form.breaking_capacity}
                          onChange={(e) => updateField("breaking_capacity", e.target.value)}
                          className="h-9 w-full appearance-none rounded border border-outline-variant bg-surface-container-lowest pl-space-sm pr-7 font-telemetry-md text-telemetry-md text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">—</option>
                          {BREAKING_CAPACITIES.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                          {form.breaking_capacity && !BREAKING_CAPACITIES.includes(form.breaking_capacity) && (
                            <option value={form.breaking_capacity}>{form.breaking_capacity}</option>
                          )}
                        </select>
                        <Icon name="expand_more" size={16} className="pointer-events-none absolute right-space-xs text-on-surface-variant" />
                      </div>
                    </FormField>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 2: Add Item + configured feeder BOM table */}
            <section className="flex flex-col gap-space-sm overflow-hidden rounded bg-surface-container-lowest shadow-sm">
              <div className="flex flex-col gap-space-sm p-space-md pb-0">
                <div className="flex flex-col justify-between gap-space-sm md:flex-row md:items-center">
                  <div className="flex items-center gap-space-sm">
                    <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 text-primary">
                      <Icon name="add_box" size={16} />
                    </div>
                    <h3 className="font-headline-sm text-headline-sm leading-tight text-on-surface">Add Item</h3>
                  </div>
                  <a
                    href="/item-master"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-space-xs self-start rounded bg-surface-container-low px-space-sm py-space-xs font-body-sm text-body-sm font-medium text-on-surface shadow-sm transition-colors hover:bg-surface-container md:self-auto"
                  >
                    <Icon name="open_in_new" size={16} /> Browse Item Master Catalog
                  </a>
                </div>
                <div className="flex flex-col items-stretch gap-space-sm md:flex-row md:items-center">
                  <div className="relative flex flex-1 items-center">
                    <Icon name="search" size={18} className="pointer-events-none absolute left-space-sm text-on-surface-variant" />
                    <input
                      value={itemSearch}
                      onChange={(e) => {
                        setItemSearch(e.target.value);
                        setSelectedItem(null);
                      }}
                      placeholder="Search Item Master by SKU, description, vendor catalog #, or brand..."
                      className="h-9 w-full rounded border border-outline-variant bg-surface-container-low/40 pl-9 pr-space-md font-body-md text-body-md text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {itemMatches.length > 0 && !selectedItem && (
                      <div className="absolute top-full z-10 mt-1 max-h-56 w-full overflow-y-auto rounded border border-outline-variant bg-surface-container-lowest shadow-md">
                        {itemMatches.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setSelectedItem(item);
                              setItemSearch(`${itemCode(item)} — ${item.description}`);
                            }}
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
                  <button
                    type="button"
                    onClick={addSelectedItem}
                    disabled={!selectedItem}
                    className="flex h-9 shrink-0 items-center gap-space-xs rounded bg-primary px-space-md font-body-sm text-body-sm font-medium text-on-primary shadow-sm transition-colors hover:bg-primary-container disabled:opacity-50"
                  >
                    <Icon name="add" size={16} /> Add to Feeder
                  </button>
                </div>
                <div className="flex items-center gap-space-xs overflow-x-auto pt-space-2xs font-label-sm text-label-sm">
                  <span className="shrink-0 font-medium text-on-surface-variant">Quick Filters:</span>
                  <button
                    type="button"
                    onClick={() => setCategoryChip(null)}
                    className={`shrink-0 rounded-full px-space-sm py-space-2xs shadow-sm transition-colors ${categoryChip === null ? "bg-primary font-semibold text-on-primary" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface"}`}
                  >
                    All Items
                  </button>
                  {itemCategories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategoryChip(c)}
                      className={`shrink-0 rounded-full px-space-sm py-space-2xs transition-colors ${categoryChip === c ? "bg-primary font-semibold text-on-primary shadow-sm" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface"}`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="w-full overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-surface-container-low font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                      <th className="w-10 py-space-sm pl-space-lg pr-space-xs text-center">#</th>
                      <th className="px-space-sm py-space-sm">SKU</th>
                      <th className="px-space-sm py-space-sm">Vendor Cat</th>
                      <th className="px-space-sm py-space-sm">Make</th>
                      <th className="px-space-sm py-space-sm">Category</th>
                      <th className="min-w-[240px] px-space-sm py-space-sm">Description</th>
                      <th className="w-20 px-space-sm py-space-sm text-center">Qty</th>
                      <th className="px-space-sm py-space-sm text-right">List Price</th>
                      <th className="w-20 px-space-sm py-space-sm text-right">Disc %</th>
                      <th className="px-space-sm py-space-sm text-right">Net Rate</th>
                      <th className="w-16 px-space-sm py-space-sm text-center">UOM</th>
                      <th className="px-space-sm py-space-sm text-right">Amount</th>
                      <th className="w-28 py-space-sm pl-space-xs pr-space-lg text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="font-body-sm text-body-sm text-on-surface">
                    {selectedLines.map((line, i) => (
                      <tr key={line.id} className={`group transition-colors hover:bg-surface-container-low/60 ${i % 2 === 1 ? "bg-surface-container-low/20" : ""}`}>
                        <td className="py-space-sm pl-space-lg pr-space-xs text-center font-telemetry-md text-on-surface-variant">{i + 1}</td>
                        <td className="px-space-sm py-space-sm font-telemetry-md text-telemetry-md font-bold text-primary">{itemCode(line.item)}</td>
                        <td className="px-space-sm py-space-sm font-label-md text-label-md text-on-surface-variant">{line.item.supplier || "—"}</td>
                        <td className="px-space-sm py-space-sm text-on-surface-variant">{line.item.make || "—"}</td>
                        <td className="px-space-sm py-space-sm text-on-surface-variant">{line.item.category || "—"}</td>
                        <td className="px-space-sm py-space-sm font-medium text-on-surface">{line.item.description}</td>
                        <td className="px-space-sm py-space-sm text-center">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.qty}
                            onChange={(e) => updateLineQty(line.id, Number(e.target.value) || 0)}
                            className="h-7 w-14 rounded bg-surface-container-low text-center font-telemetry-md text-telemetry-md focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>
                        <td className="px-space-sm py-space-sm text-right font-telemetry-md text-on-surface-variant">
                          {line.item.list_price != null ? money(line.item.list_price) : "—"}
                        </td>
                        <td className="px-space-sm py-space-sm text-right font-telemetry-md text-tertiary">
                          {line.item.discount_pct != null ? `${line.item.discount_pct}%` : "—"}
                        </td>
                        <td className="px-space-sm py-space-sm text-right font-telemetry-md text-on-surface">{money(lineNetRate(line))}</td>
                        <td className="px-space-sm py-space-sm text-center font-label-md text-label-md uppercase text-on-surface-variant">{line.item.uom}</td>
                        <td className="px-space-sm py-space-sm text-right font-telemetry-md text-telemetry-md font-bold text-on-surface">
                          {money(line.qty * lineNetRate(line))}
                        </td>
                        <td className="py-space-sm pl-space-xs pr-space-lg text-right">
                          <div className="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100">
                            <button
                              onClick={() => moveLine(line.id, -1)}
                              disabled={i === 0}
                              title="Move Up"
                              className="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:opacity-30"
                            >
                              <Icon name="arrow_upward" size={15} />
                            </button>
                            <button
                              onClick={() => moveLine(line.id, 1)}
                              disabled={i === selectedLines.length - 1}
                              title="Move Down"
                              className="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:opacity-30"
                            >
                              <Icon name="arrow_downward" size={15} />
                            </button>
                            <button
                              onClick={() => removeLine(line.id)}
                              title="Remove"
                              className="flex h-6 w-6 items-center justify-center rounded text-error hover:bg-error-container"
                            >
                              <Icon name="delete" size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {selectedLines.length === 0 && (
                      <tr>
                        <td colSpan={13} className="px-space-lg py-space-lg text-center text-secondary">
                          No items yet. Search above to add one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-space-xs">
      <label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">{label}</label>
      {children}
    </div>
  );
}
