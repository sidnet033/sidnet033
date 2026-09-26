"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { itemCode } from "@/lib/item-display";
import { numericKeyGuard } from "@/lib/numeric-input";
import { Icon } from "@/components/icon";
import { SavingOverlay } from "@/components/saving-overlay";
import { DEVICE_TYPE_LABELS, MOTOR_STARTER_TYPES } from "@/lib/artuk-sizing";
import type { DeviceType, Feeder, ItemMaster } from "@/types/database";

const FEEDER_TYPES = ["Incomer", "Outgoing", "Bus Coupler", "Sub-Incomer", "APFC Capacitor Bank"];
const DEVICE_TYPES = Object.keys(DEVICE_TYPE_LABELS) as DeviceType[];

type NewFeederLine = { item: ItemMaster; qty: number };

export function AdHocFeederPanel({
  switchboardId,
  allItems,
  onCreated,
}: {
  switchboardId: string;
  allItems: ItemMaster[];
  onCreated: (feeder: Feeder & { cost: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [deviceType, setDeviceType] = useState<DeviceType | "">("");
  const [ratedCurrent, setRatedCurrent] = useState("");
  const [ratedKw, setRatedKw] = useState("");
  const [lines, setLines] = useState<NewFeederLine[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = itemSearch
    ? allItems
        .filter(
          (i) =>
            itemCode(i).toLowerCase().includes(itemSearch.toLowerCase()) ||
            i.description.toLowerCase().includes(itemSearch.toLowerCase())
        )
        .slice(0, 8)
    : [];

  function addLine() {
    const item = allItems.find((i) => i.id === selectedItemId);
    if (!item) return;
    setLines([...lines, { item, qty: Number(qty) || 1 }]);
    setSelectedItemId("");
    setItemSearch("");
    setQty("1");
  }

  function removeLine(itemId: string) {
    setLines(lines.filter((l) => l.item.id !== itemId));
  }

  function reset() {
    setName("");
    setCategory("");
    setDeviceType("");
    setRatedCurrent("");
    setRatedKw("");
    setLines([]);
    setError(null);
    setOpen(false);
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError("Give the feeder a name.");
      return;
    }
    if (lines.length === 0) {
      setError("Add at least one item.");
      return;
    }
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: feeder, error: feederError } = await supabase
      .from("feeders")
      .insert({
        name: name.trim(),
        category: category || null,
        device_type: deviceType || null,
        rated_current: ratedCurrent ? Number(ratedCurrent) : null,
        rated_kw: ratedKw ? Number(ratedKw) : null,
        switchboard_id: switchboardId,
        is_library: false,
        created_by: user?.id,
      })
      .select("*")
      .single();

    if (feederError || !feeder) {
      setError(feederError?.message ?? "Could not create feeder.");
      setSaving(false);
      return;
    }

    const { error: linesError } = await supabase
      .from("feeder_items")
      .insert(lines.map((l) => ({ feeder_id: feeder.id, item_id: l.item.id, qty: l.qty })));

    setSaving(false);

    if (linesError) {
      setError(linesError.message);
      return;
    }

    const cost = lines.reduce((sum, l) => sum + l.qty * l.item.unit_cost, 0);
    onCreated({ ...feeder, cost });
    reset();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-outline w-72">
        <Icon name="add_circle" size={16} /> Create New Feeder
      </button>
    );
  }

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-surface-container-high bg-surface-container-low p-3">
      <SavingOverlay show={saving} label="Creating feeder..." />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Feeder name"
        className="w-full rounded border border-surface-container-high px-2 py-1 text-xs"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded border border-surface-container-high px-2 py-1 text-xs"
        >
          <option value="">Function (optional)...</option>
          {FEEDER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={deviceType}
          onChange={(e) => setDeviceType(e.target.value as DeviceType | "")}
          className="w-full rounded border border-surface-container-high px-2 py-1 text-xs"
        >
          <option value="">Device type (optional)...</option>
          {DEVICE_TYPES.map((t) => (
            <option key={t} value={t}>
              {DEVICE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {deviceType && (
        <div className="flex items-center gap-2">
          {MOTOR_STARTER_TYPES.includes(deviceType as DeviceType) ? (
            <input
              type="text"
              inputMode="decimal"
              value={ratedKw}
              onChange={(e) => setRatedKw(e.target.value)}
              onKeyDown={numericKeyGuard()}
              placeholder="Rated power (kW)"
              className="w-full rounded border border-surface-container-high px-2 py-1 text-xs"
            />
          ) : (
            <input
              type="text"
              inputMode="decimal"
              value={ratedCurrent}
              onChange={(e) => setRatedCurrent(e.target.value)}
              onKeyDown={numericKeyGuard()}
              placeholder="Rated current (A)"
              className="w-full rounded border border-surface-container-high px-2 py-1 text-xs"
            />
          )}
        </div>
      )}

      <div className="relative">
        <input
          value={itemSearch}
          onChange={(e) => {
            setItemSearch(e.target.value);
            setSelectedItemId("");
          }}
          placeholder="Search item master..."
          autoComplete="off"
          className="w-full rounded border border-surface-container-high px-2 py-1 text-xs"
        />
        {matches.length > 0 && !selectedItemId && (
          <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-surface-container-high bg-surface-container-lowest shadow-sm">
            {matches.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => {
                  setSelectedItemId(m.id);
                  setItemSearch(`${itemCode(m)} — ${m.description}`);
                }}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-surface-container-low"
              >
                <span className="w-24 shrink-0 truncate font-mono text-secondary">{itemCode(m)}</span>
                <span className="w-24 shrink-0 truncate font-mono text-secondary">{m.vendor_cat || "—"}</span>
                <span className="w-28 shrink-0 truncate text-on-surface-variant">{m.make || "—"}</span>
                <span className="min-w-0 flex-1 truncate">{m.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={numericKeyGuard()}
          className="w-16 rounded border border-surface-container-high px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={addLine}
          disabled={!selectedItemId}
          className="rounded bg-secondary px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          Add line
        </button>
      </div>

      {lines.length > 0 && (
        <ul className="space-y-1 text-xs">
          {lines.map((l) => (
            <li key={l.item.id} className="flex items-center justify-between rounded bg-surface-container-lowest px-2 py-1">
              <span className="truncate">
                {l.qty} × {itemCode(l.item)}
              </span>
              <button onClick={() => removeLine(l.item.id)} className="text-error hover:underline">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-error">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={handleCreate} disabled={saving} className="btn btn-primary btn-sm">
          {saving ? "Creating..." : "Create feeder"}
        </button>
        <button onClick={reset} className="btn btn-outline btn-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
