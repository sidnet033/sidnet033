"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { createClient } from "@/lib/supabase/client";
import type { BayType, Feeder, PlacedFeeder, Switchboard, Vertical } from "@/types/database";
import { Icon } from "@/components/icon";
import { SavingOverlay } from "@/components/saving-overlay";
import { numericKeyGuard } from "@/lib/numeric-input";

type VerticalWithFeeders = Vertical & {
  placed: (PlacedFeeder & { feeder: Feeder })[];
};
type PlacedWithFeeder = VerticalWithFeeders["placed"][number];

// One draggable card per physical unit of a feeder waiting to be placed --
// a placed_feeders row of qty 3 sitting in the unassigned bucket shows up
// here as 3 separate cards, each of which moves exactly one unit into a
// bay when dropped.
type AvailableUnit = { unitId: string; placedId: string; feeder: Feeder };

const BAY_TEMPLATES: { bay_type: BayType; label: string; namePrefix: string }[] = [
  { bay_type: "incomer", label: "+ Incomer Bay", namePrefix: "Incomer" },
  { bay_type: "outgoing", label: "+ Outgoing Bay", namePrefix: "Outgoing" },
  { bay_type: "riser", label: "+ Cable Spreader", namePrefix: "Riser" },
  { bay_type: "bus_coupler", label: "+ Bus Coupler", namePrefix: "Bus Coupler" },
  { bay_type: "bay", label: "+ Add Bay", namePrefix: "Bay" },
  { bay_type: "cable_alley", label: "+ Cable Alley", namePrefix: "Cable Alley" },
  { bay_type: "busbar_alley", label: "+ Busbar Alley", namePrefix: "Busbar Alley" },
];

const PLINTH_OPTIONS = [75, 100, 150, 200];
const PANEL_HEIGHT_OPTIONS = [1800, 2000, 2100, 2200];

function newId() {
  return `new-${crypto.randomUUID()}`;
}

async function loadGaData(supabase: ReturnType<typeof createClient>, switchboardId: string) {
  const { data: switchboard } = await supabase.from("switchboards").select("*").eq("id", switchboardId).single();
  if (!switchboard) return null;

  const { data: verticals } = await supabase
    .from("verticals")
    .select("*")
    .eq("switchboard_id", switchboardId)
    .order("sort_order");

  const verticalIds = (verticals ?? []).map((v) => v.id);
  const { data: placed } = verticalIds.length
    ? await supabase.from("placed_feeders").select("*, feeder:feeders(*)").in("vertical_id", verticalIds).order("sort_order")
    : { data: [] };

  const verticalsWithFeeders: VerticalWithFeeders[] = (verticals ?? []).map((v) => ({
    ...v,
    placed: ((placed ?? []) as unknown as (PlacedFeeder & { feeder: Feeder; vertical_id: string })[]).filter(
      (p) => p.vertical_id === v.id
    ),
  }));

  return {
    switchboard: switchboard as Switchboard,
    verticals: verticalsWithFeeders,
  };
}

function makeSpareFeeder(name: string): Feeder {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name,
    description: null,
    category: "Spare",
    tag: null,
    rating_summary: null,
    switchboard_id: null,
    is_library: false,
    created_by: null,
    created_at: now,
    updated_at: now,
    rated_current: null,
    pole_config: null,
    breaking_capacity: null,
  };
}

// The unassigned bucket may not exist in the DB yet (a fresh switchboard
// with nothing added from BOM Builder or GA) -- create a draft-only
// placeholder for it (a temp id, only ever inserted on Save) instead of
// hitting Supabase, since every GA mutation is draft-only until Save runs.
function withUnassigned(verts: VerticalWithFeeders[], switchboardId: string): { unassigned: VerticalWithFeeders; verts: VerticalWithFeeders[] } {
  const existing = verts.find((v) => v.bay_type === "unassigned");
  if (existing) return { unassigned: existing, verts };
  const created: VerticalWithFeeders = {
    id: "new-unassigned",
    switchboard_id: switchboardId,
    name: "Unallocated",
    width_mm: null,
    depth_mm: null,
    bay_type: "unassigned",
    sort_order: -1,
    created_at: new Date().toISOString(),
    placed: [],
  };
  return { unassigned: created, verts: [...verts, created] };
}

// Moving units into a vertical that already holds a placement of the same
// feeder merges into it (qty+n) instead of adding a second row for the same
// feeder in the same bay -- without this, dragging several units of one
// feeder into one bay one at a time left them as separate placed_feeders
// rows, which then showed up in BOM Builder as separate feeder cards
// instead of one feeder at its real qty.
function mergeQtyInto(verts: VerticalWithFeeders[], targetVerticalId: string, feederId: string, feeder: Feeder, qty: number): VerticalWithFeeders[] {
  return verts.map((v) => {
    if (v.id !== targetVerticalId) return v;
    const existing = v.placed.find((p) => p.feeder_id === feederId);
    if (existing) return { ...v, placed: v.placed.map((p) => (p.id === existing.id ? { ...p, qty: p.qty + qty } : p)) };
    const newRow: PlacedWithFeeder = {
      id: newId(),
      vertical_id: targetVerticalId,
      feeder_id: feederId,
      label_override: null,
      qty,
      sort_order: v.placed.length,
      tier_number: 1,
      created_at: new Date().toISOString(),
      feeder,
    };
    return { ...v, placed: [...v.placed, newRow] };
  });
}

// The inverse of mergeQtyInto for a single unit: takes exactly one unit's worth off the
// matching row in a vertical, dropping the row once it reaches zero.
function removeUnitFrom(verts: VerticalWithFeeders[], sourceVerticalId: string, feederId: string): VerticalWithFeeders[] {
  return verts.map((v) => {
    if (v.id !== sourceVerticalId) return v;
    const existing = v.placed.find((p) => p.feeder_id === feederId);
    if (!existing) return v;
    if (existing.qty > 1) return { ...v, placed: v.placed.map((p) => (p.id === existing.id ? { ...p, qty: p.qty - 1 } : p)) };
    return { ...v, placed: v.placed.filter((p) => p.id !== existing.id) };
  });
}

export function GaCanvas({
  switchboardId,
  currentUserId,
  revisionArchived,
}: {
  switchboardId: string;
  currentUserId: string;
  revisionArchived: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [sb, setSb] = useState<Switchboard | null>(null);

  // Draft/save, same pattern as BOM Builder: every mutation below touches
  // only these draft values; nothing reaches Supabase until Save (or
  // Ctrl+S) runs and diffs the draft against the `saved*` snapshot.
  const [verticals, setVerticals] = useState<VerticalWithFeeders[]>([]);
  const [savedVerticals, setSavedVerticals] = useState<VerticalWithFeeders[]>([]);
  const [plinthHeight, setPlinthHeight] = useState(100);
  const [savedPlinthHeight, setSavedPlinthHeight] = useState(100);
  const [panelHeight, setPanelHeight] = useState(2100);
  const [savedPanelHeight, setSavedPanelHeight] = useState(2100);
  const [saving, setSaving] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const [search, setSearch] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [draggingFeeder, setDraggingFeeder] = useState<Feeder | null>(null);

  async function refreshGaData() {
    const data = await loadGaData(supabase, switchboardId);
    if (!data) return;
    setSb(data.switchboard);
    setVerticals(data.verticals);
    setSavedVerticals(data.verticals);
    const plinth = data.switchboard.plinth_height_mm ?? 100;
    const panel = data.switchboard.panel_height_mm ?? 2100;
    setPlinthHeight(plinth);
    setSavedPlinthHeight(plinth);
    setPanelHeight(panel);
    setSavedPanelHeight(panel);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await loadGaData(supabase, switchboardId);
      if (cancelled || !data) return;
      setSb(data.switchboard);
      setVerticals(data.verticals);
      setSavedVerticals(data.verticals);
      const plinth = data.switchboard.plinth_height_mm ?? 100;
      const panel = data.switchboard.panel_height_mm ?? 2100;
      setPlinthHeight(plinth);
      setSavedPlinthHeight(plinth);
      setPanelHeight(panel);
      setSavedPanelHeight(panel);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, switchboardId]);

  const readOnly = !sb || revisionArchived || (sb.locked_by !== null && sb.locked_by !== currentUserId);

  const dirty =
    JSON.stringify(verticals) !== JSON.stringify(savedVerticals) ||
    plinthHeight !== savedPlinthHeight ||
    panelHeight !== savedPanelHeight;

  const bays = verticals.filter((v) => v.bay_type !== "unassigned").sort((a, b) => a.sort_order - b.sort_order);
  const unallocated = verticals.find((v) => v.bay_type === "unassigned") ?? null;
  const totalWidth = bays.reduce((s, v) => s + (v.width_mm ?? 0), 0);

  // Physically, the busbar chamber sits away from wherever cables enter the
  // panel (more room to route cable near the entry side); the base plinth
  // is always the floor support, so it stays at the very bottom regardless.
  const busbarPosition: "top" | "bottom" = sb?.cable_entry === "Top" ? "bottom" : "top";

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const availableUnits: AvailableUnit[] = useMemo(() => {
    if (!unallocated) return [];
    const units: AvailableUnit[] = [];
    for (const p of unallocated.placed) {
      for (let i = 0; i < p.qty; i++) {
        units.push({ unitId: `${p.id}::${i}`, placedId: p.id, feeder: p.feeder });
      }
    }
    return units;
  }, [unallocated]);

  const filteredUnits = availableUnits.filter(
    (u) =>
      u.feeder.name.toLowerCase().includes(search.toLowerCase()) ||
      (u.feeder.category ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function addBay(template: (typeof BAY_TEMPLATES)[number]) {
    if (!sb) return;
    const count = bays.filter((b) => b.bay_type === template.bay_type).length + 1;
    const created: VerticalWithFeeders = {
      id: newId(),
      switchboard_id: sb.id,
      name: `${template.namePrefix} ${count}`,
      bay_type: template.bay_type,
      width_mm: 600,
      depth_mm: null,
      sort_order: bays.length,
      created_at: new Date().toISOString(),
      placed: [],
    };
    setVerticals([...verticals, created]);
  }

  function renameBay(id: string, newName: string) {
    setVerticals(verticals.map((v) => (v.id === id ? { ...v, name: newName } : v)));
  }

  function setBayDim(id: string, field: "width_mm" | "depth_mm", value: string) {
    const num = value ? Number(value) : null;
    setVerticals(verticals.map((v) => (v.id === id ? { ...v, [field]: num } : v)));
  }

  function deleteBay(id: string) {
    if (!confirm("Delete this bay? Anything placed in it goes back to the available feeders list.")) return;
    if (!sb) return;
    const vertical = verticals.find((v) => v.id === id);
    if (!vertical) return;

    if (vertical.placed.length === 0) {
      setVerticals(verticals.filter((v) => v.id !== id));
      return;
    }
    const { unassigned, verts } = withUnassigned(verticals, sb.id);
    let next = verts;
    for (const p of vertical.placed) {
      next = mergeQtyInto(next, unassigned.id, p.feeder_id, p.feeder, p.qty);
    }
    setVerticals(next.filter((v) => v.id !== id));
  }

  function addSpare() {
    if (!sb || readOnly) return;
    const name = window.prompt('Name this spare feeder (e.g. "Spare", "Future Outgoing")', "Spare");
    if (name === null) return;
    const trimmedName = name.trim() || "Spare";
    const qtyInput = window.prompt("How many spare units?", "1");
    const qty = Math.max(1, Math.round(Number(qtyInput) || 1));

    const feeder = makeSpareFeeder(trimmedName);
    const { unassigned, verts } = withUnassigned(verticals, sb.id);
    const newRow: PlacedWithFeeder = {
      id: newId(),
      vertical_id: unassigned.id,
      feeder_id: feeder.id,
      label_override: null,
      qty,
      sort_order: unassigned.placed.length,
      tier_number: 1,
      created_at: new Date().toISOString(),
      feeder,
    };
    setVerticals(verts.map((v) => (v.id === unassigned.id ? { ...v, placed: [...v.placed, newRow] } : v)));
  }

  // A unit dropped from the available-feeders list moves exactly one unit
  // of that placement into the target bay. If the target bay already holds
  // a placement of the same feeder, it merges into it (qty+1) instead of
  // creating a second row for the same feeder in the same bay.
  function allocateUnit(placedId: string, toVerticalId: string) {
    if (!unallocated) return;
    const placedRow = unallocated.placed.find((p) => p.id === placedId);
    if (!placedRow) return;
    const afterRemove = removeUnitFrom(verticals, unallocated.id, placedRow.feeder_id);
    setVerticals(mergeQtyInto(afterRemove, toVerticalId, placedRow.feeder_id, placedRow.feeder, 1));
  }

  // "Removing" a feeder from a bay sends its whole placement (however many
  // units it holds) back to the available-feeders list instead of deleting
  // it -- feeders (other than spares) belong to the BOM, so GA only ever
  // re-files their placement, never their existence. It merges into
  // whatever's already unassigned for that feeder rather than creating a
  // duplicate row there.
  function removeFromBay(verticalId: string, placedId: string) {
    if (!sb) return;
    const vertical = verticals.find((v) => v.id === verticalId);
    const placedRow = vertical?.placed.find((p) => p.id === placedId);
    if (!placedRow) return;

    const { unassigned, verts } = withUnassigned(verticals, sb.id);
    const withoutRow = verts.map((v) => (v.id === verticalId ? { ...v, placed: v.placed.filter((p) => p.id !== placedId) } : v));
    setVerticals(mergeQtyInto(withoutRow, unassigned.id, placedRow.feeder_id, placedRow.feeder, placedRow.qty));
  }

  function handleCancel() {
    setVerticals(structuredClone(savedVerticals));
    setPlinthHeight(savedPlinthHeight);
    setPanelHeight(savedPanelHeight);
    setResetKey((k) => k + 1);
  }

  async function handleSave() {
    if (!sb || readOnly) return;
    setSaving(true);
    try {
      const tempVerticalIdMap = new Map<string, string>();
      const tempFeederIdMap = new Map<string, string>();

      for (const v of verticals) {
        if (!v.id.startsWith("new-")) continue;
        const { data, error } = await supabase
          .from("verticals")
          .insert({ switchboard_id: sb.id, name: v.name, bay_type: v.bay_type, width_mm: v.width_mm, depth_mm: v.depth_mm, sort_order: v.sort_order })
          .select("id")
          .single();
        if (error || !data) throw new Error(error?.message ?? "Could not create bay.");
        tempVerticalIdMap.set(v.id, (data as { id: string }).id);
      }

      for (const v of verticals) {
        if (v.id.startsWith("new-")) continue;
        const prev = savedVerticals.find((x) => x.id === v.id);
        if (!prev) continue;
        const fieldPatch: Partial<Vertical> = {};
        if (v.name !== prev.name) fieldPatch.name = v.name;
        if (v.width_mm !== prev.width_mm) fieldPatch.width_mm = v.width_mm;
        if (v.depth_mm !== prev.depth_mm) fieldPatch.depth_mm = v.depth_mm;
        if (Object.keys(fieldPatch).length === 0) continue;
        const { error } = await supabase.from("verticals").update(fieldPatch).eq("id", v.id);
        if (error) throw new Error(error.message);
      }

      const seenTempFeeders = new Set<string>();
      for (const v of verticals) {
        for (const p of v.placed) {
          if (!p.feeder_id.startsWith("new-") || seenTempFeeders.has(p.feeder_id)) continue;
          seenTempFeeders.add(p.feeder_id);
          const { data, error } = await supabase
            .from("feeders")
            .insert({ name: p.feeder.name, category: p.feeder.category, switchboard_id: sb.id, is_library: false, created_by: currentUserId })
            .select("id")
            .single();
          if (error || !data) throw new Error(error?.message ?? "Could not create spare feeder.");
          tempFeederIdMap.set(p.feeder_id, (data as { id: string }).id);
        }
      }

      const keptPlacedIds = new Set<string>();
      for (const v of verticals) {
        const realVerticalId = tempVerticalIdMap.get(v.id) ?? v.id;
        for (const p of v.placed) {
          const realFeederId = tempFeederIdMap.get(p.feeder_id) ?? p.feeder_id;
          if (p.id.startsWith("new-")) {
            const { error } = await supabase
              .from("placed_feeders")
              .insert({ vertical_id: realVerticalId, feeder_id: realFeederId, qty: p.qty, sort_order: p.sort_order, tier_number: p.tier_number });
            if (error) throw new Error(error.message);
            continue;
          }
          keptPlacedIds.add(p.id);
          const prevVertical = savedVerticals.find((sv) => sv.placed.some((sp) => sp.id === p.id));
          const prev = prevVertical?.placed.find((sp) => sp.id === p.id);
          const fieldPatch: Partial<PlacedFeeder> = {};
          if (!prevVertical || prevVertical.id !== v.id) fieldPatch.vertical_id = realVerticalId;
          if (!prev || prev.sort_order !== p.sort_order) fieldPatch.sort_order = p.sort_order;
          if (!prev || prev.qty !== p.qty) fieldPatch.qty = p.qty;
          if (Object.keys(fieldPatch).length === 0) continue;
          const { error } = await supabase.from("placed_feeders").update(fieldPatch).eq("id", p.id);
          if (error) throw new Error(error.message);
        }
      }

      for (const sv of savedVerticals) {
        for (const sp of sv.placed) {
          if (keptPlacedIds.has(sp.id)) continue;
          const { error } = await supabase.from("placed_feeders").delete().eq("id", sp.id);
          if (error) throw new Error(error.message);
        }
      }

      for (const sv of savedVerticals) {
        if (verticals.some((v) => v.id === sv.id)) continue;
        const { error } = await supabase.from("verticals").delete().eq("id", sv.id);
        if (error) throw new Error(error.message);
      }

      const paramPatch: Partial<Switchboard> = {};
      if (plinthHeight !== savedPlinthHeight) paramPatch.plinth_height_mm = plinthHeight;
      if (panelHeight !== savedPanelHeight) paramPatch.panel_height_mm = panelHeight;
      if (Object.keys(paramPatch).length > 0) {
        const { error } = await supabase.from("switchboards").update(paramPatch).eq("id", sb.id);
        if (error) throw new Error(error.message);
      }

      await refreshGaData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not save the GA layout.");
    } finally {
      setSaving(false);
    }
  }

  // Ctrl+S / Cmd+S saves the GA layout, same as clicking "Save Changes".
  // handleSave closes over the latest draft/saved on every render, so it's
  // tracked via a ref (updated on every render) rather than a useEffect
  // dependency -- that keeps the listener itself mounted once while always
  // calling the freshest save function instead of one captured from a
  // stale render.
  const keyboardSaveRef = useRef({ readOnly, dirty, saving, handleSave: () => {} });
  useEffect(() => {
    keyboardSaveRef.current = { readOnly, dirty, saving, handleSave };
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const { readOnly, dirty, saving, handleSave } = keyboardSaveRef.current;
        if (!readOnly && dirty && !saving) handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("unit-")) {
      const placedId = id.replace("unit-", "").split("::")[0];
      const placed = unallocated?.placed.find((p) => p.id === placedId);
      if (placed) setDraggingFeeder(placed.feeder);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingFeeder(null);
    const { active, over } = event;
    if (!over || readOnly) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (!overId.startsWith("bay-")) return;
    const verticalId = overId.replace("bay-", "");

    if (activeId.startsWith("unit-") && unallocated) {
      const placedId = activeId.replace("unit-", "").split("::")[0];
      allocateUnit(placedId, verticalId);
    }
  }

  if (loading || !sb) {
    return <div className="p-8 text-sm text-on-surface-variant">Loading...</div>;
  }

  const busbarBar = (
    <div
      className={`flex items-center justify-center border-amber-300/60 bg-amber-50 py-2 text-[11px] font-medium text-amber-800 ${
        busbarPosition === "top" ? "mb-2 rounded-t-lg border border-b-0" : "mt-2 border"
      }`}
      style={{ minWidth: bays.length * 220 }}
    >
      Busbar Chamber{sb.amps ? ` · ${sb.amps}A` : ""}
      {sb.ka ? ` · ${sb.ka}kA` : ""} {sb.busbar ?? "Cu"} Horizontal Busbar
    </div>
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-full flex-col">
        <SavingOverlay show={saving} />
        <div className="flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container-high bg-surface-container-lowest px-margin-lg py-space-md">
          <h1 className="font-display text-headline-lg text-on-surface">
            GA Builder — {sb.tag}
            {sb.title ? `: ${sb.title}` : ""}
          </h1>
          <div className="flex items-center gap-space-sm">
            {!readOnly && dirty && <span className="font-body-sm text-body-sm text-amber-600">Unsaved changes</span>}
            {!readOnly && !dirty && <span className="font-body-sm text-body-sm text-tertiary">Saved</span>}
            <button
              disabled
              title="Export coming soon"
              className="flex items-center gap-1 rounded bg-surface-container-low px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant opacity-60"
            >
              <Icon name="ios_share" size={16} /> Export GA (DXF/DWG/PDF)
            </button>
            {!readOnly && (
              <>
                <button onClick={handleCancel} disabled={!dirty || saving} className="btn btn-outline">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={!dirty || saving} className="btn btn-primary">
                  <Icon name="save" size={16} />
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </>
            )}
          </div>
        </div>

        {readOnly && (
          <div className="flex items-center gap-2 border-b border-amber-200/80 bg-amber-50/60 px-4 py-2 text-xs text-amber-800">
            <Icon name="visibility" size={15} />
            {revisionArchived
              ? "This revision is archived — read only."
              : "This switchboard is locked by another user — read only until it's released."}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4 border-b border-surface-container-high bg-surface-container-low/60 px-4 py-2.5 text-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-secondary">Switchboard Master Parameters</p>
          <Field label="Plinth Height">
            <select
              disabled={readOnly}
              value={plinthHeight}
              onChange={(e) => setPlinthHeight(Number(e.target.value))}
              className="rounded border border-surface-container-high px-1.5 py-1"
            >
              {PLINTH_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}mm
                </option>
              ))}
            </select>
          </Field>
          <Field label="Panel Height">
            <select
              disabled={readOnly}
              value={panelHeight}
              onChange={(e) => setPanelHeight(Number(e.target.value))}
              className="rounded border border-surface-container-high px-1.5 py-1"
            >
              {PANEL_HEIGHT_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}mm
                </option>
              ))}
            </select>
          </Field>
          <ReadOnlyField label="Form of Separation" value={sb.form_of_separation} />
          <ReadOnlyField label="Amps" value={sb.amps != null ? `${sb.amps}A` : null} />
          <ReadOnlyField label="kA" value={sb.ka != null ? `${sb.ka}kA` : null} />
          <ReadOnlyField label="Cable Entry" value={sb.cable_entry} />
          <ReadOnlyField label="Cable Exit" value={sb.cable_exit} />
          <span className="text-[10px] text-on-surface-variant">Set in Project Detail →</span>
          <button
            onClick={() => alert("Export (DXF / DWG / PDF) is coming in a later phase.")}
            className="ml-auto flex items-center gap-1 rounded-md border border-surface-container-high bg-surface-container-lowest px-2.5 py-1.5 font-medium text-on-surface hover:bg-surface-container-low"
          >
            <Icon name="download" size={14} /> Export GA
          </button>
        </div>

        <div className="flex flex-1 gap-4 overflow-hidden p-4">
          <aside
            className={`shrink-0 overflow-y-auto rounded-xl border border-surface-container-high bg-surface-container-lowest shadow-xs transition-[width] ${
              sidebarCollapsed ? "w-11 p-2" : "w-72 p-3"
            }`}
          >
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? "Expand available feeders" : "Collapse available feeders"}
              className={`mb-2 flex items-center justify-center rounded p-1 text-secondary hover:bg-surface-container-low ${
                sidebarCollapsed ? "w-full" : ""
              }`}
            >
              <Icon name={sidebarCollapsed ? "chevron_right" : "chevron_left"} size={16} />
            </button>

            {sidebarCollapsed ? (
              filteredUnits.length > 0 && (
                <div className="flex justify-center">
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {filteredUnits.length}
                  </span>
                </div>
              )
            ) : (
              <>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-secondary">Available Feeders</p>
                <p className="mb-2 text-[11px] text-on-surface-variant">
                  Feeders come from BOM Builder. Use a spare to fill a gap in a bay.
                </p>
                {!readOnly && (
                  <button onClick={addSpare} className="btn btn-outline btn-sm mb-3 w-full">
                    <Icon name="add_circle" size={14} /> Add Spare Feeder
                  </button>
                )}
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search feeders..."
                  className="mb-3 w-full rounded-md border border-surface-container-high px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="mb-2 text-xs text-on-surface-variant">
                  {readOnly ? "Read only — lock this switchboard to edit." : "Drag a feeder onto a bay →"}
                </p>
                <div className="space-y-2">
                  {filteredUnits.map((u) => (
                    <AvailableFeederCard key={u.unitId} unit={u} disabled={readOnly} />
                  ))}
                  {filteredUnits.length === 0 && (
                    <p className="text-sm text-on-surface-variant">
                      {availableUnits.length === 0 ? "No feeders waiting to be placed. Add feeders in BOM Builder." : "No matches."}
                    </p>
                  )}
                </div>
              </>
            )}
          </aside>

          <div className="flex flex-1 flex-col overflow-hidden">
            {!readOnly && (
              <div className="mb-3 flex flex-wrap gap-2">
                {BAY_TEMPLATES.map((t) => (
                  <button
                    key={t.bay_type}
                    onClick={() => addBay(t)}
                    className="rounded-md border border-dashed border-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant hover:border-primary/40 hover:text-primary"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-x-auto rounded-xl border border-surface-container-high bg-surface-container-low/40 p-3">
              {bays.length > 0 && busbarPosition === "top" && busbarBar}
              <div className="flex gap-3" style={{ minWidth: bays.length * 220 }}>
                {bays.map((v) => (
                  <BayColumn
                    key={`${v.id}-${resetKey}`}
                    vertical={v}
                    readOnly={readOnly}
                    totalWidth={totalWidth}
                    onRename={(newName) => renameBay(v.id, newName)}
                    onDimChange={(field, val) => setBayDim(v.id, field, val)}
                    onDelete={() => deleteBay(v.id)}
                    onRemove={(placedId) => removeFromBay(v.id, placedId)}
                  />
                ))}
                {bays.length === 0 && (
                  <p className="w-full py-10 text-center text-sm text-on-surface-variant">
                    No bays yet — add one from the Modular Bay Templates above.
                  </p>
                )}
              </div>
              {bays.length > 0 && busbarPosition === "bottom" && busbarBar}
              {bays.length > 0 && (
                <div
                  className="mt-2 flex items-center justify-center gap-4 rounded-b-lg border border-t-0 border-surface-container-high bg-surface-container-high py-2 text-[11px] font-medium text-on-surface-variant"
                  style={{ minWidth: bays.length * 220 }}
                >
                  <Icon name="anchor" size={13} /> Base Plinth ({plinthHeight}mm) <Icon name="anchor" size={13} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <DragOverlay>
        {draggingFeeder && (
          <div className="w-56 rounded-md border border-surface-container-high bg-surface-container-lowest px-3 py-2 text-sm shadow-lg">
            <p className="font-medium text-on-surface">{draggingFeeder.name}</p>
            <p className="text-xs text-on-surface-variant">{draggingFeeder.category || "—"}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-secondary">
      {label}
      {children}
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="flex items-center gap-1.5 text-secondary">
      <span>{label}</span>
      <span className="rounded border border-surface-container-high bg-surface-container-low px-1.5 py-1 text-on-surface-variant">
        {value || "—"}
      </span>
    </span>
  );
}

function AvailableFeederCard({ unit, disabled = false }: { unit: AvailableUnit; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `unit-${unit.unitId}`,
    disabled,
  });

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`rounded-lg border border-surface-container-high px-3 py-2 text-sm ${
        disabled ? "opacity-60" : `cursor-grab active:cursor-grabbing ${isDragging ? "opacity-40" : "hover:border-primary/40"}`
      }`}
    >
      <p className="truncate font-medium text-on-surface">{unit.feeder.name}</p>
      <p className="text-xs text-on-surface-variant">{unit.feeder.category || "—"}</p>
    </div>
  );
}

function BayColumn({
  vertical,
  readOnly,
  totalWidth,
  onRename,
  onDimChange,
  onDelete,
  onRemove,
}: {
  vertical: VerticalWithFeeders;
  readOnly: boolean;
  totalWidth: number;
  onRename: (name: string) => void;
  onDimChange: (field: "width_mm" | "depth_mm", value: string) => void;
  onDelete: () => void;
  onRemove: (placedId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bay-${vertical.id}`, disabled: readOnly });
  const [localName, setLocalName] = useState(vertical.name);
  const [localWidth, setLocalWidth] = useState(vertical.width_mm ? String(vertical.width_mm) : "");
  const [localDepth, setLocalDepth] = useState(vertical.depth_mm ? String(vertical.depth_mm) : "");

  const widthPct = totalWidth > 0 && vertical.width_mm ? Math.round((vertical.width_mm / totalWidth) * 100) : null;
  const placed = [...vertical.placed].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="flex w-56 shrink-0 flex-col rounded-xl border border-surface-container-high bg-surface-container-lowest shadow-xs">
      <div className="border-b border-surface-container p-2">
        <div className="flex items-center justify-between">
          <input
            value={localName}
            disabled={readOnly}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={() => onRename(localName)}
            className="w-full rounded border-none bg-transparent px-1 py-0.5 text-sm font-semibold text-on-surface focus:bg-surface-container-low disabled:text-secondary"
          />
          {vertical.bay_type && (
            <span className="shrink-0 rounded border border-surface-container-high bg-surface-container-low px-1 py-0.5 text-[10px] capitalize text-secondary">
              {vertical.bay_type.replace("_", " ")}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5 px-1 text-xs text-on-surface-variant">
          <input
            type="text"
            inputMode="decimal"
            value={localWidth}
            disabled={readOnly}
            onChange={(e) => setLocalWidth(e.target.value)}
            onKeyDown={numericKeyGuard()}
            onBlur={() => onDimChange("width_mm", localWidth)}
            placeholder="W"
            className="w-14 rounded border border-surface-container-high px-1 py-0.5 disabled:bg-surface-container-low"
          />
          ×
          <input
            type="text"
            inputMode="decimal"
            value={localDepth}
            disabled={readOnly}
            onChange={(e) => setLocalDepth(e.target.value)}
            onKeyDown={numericKeyGuard()}
            onBlur={() => onDimChange("depth_mm", localDepth)}
            placeholder="D"
            className="w-14 rounded border border-surface-container-high px-1 py-0.5 disabled:bg-surface-container-low"
          />
          <span>mm{widthPct !== null && ` · ${widthPct}%`}</span>
        </div>
        {!readOnly && (
          <div className="mt-1 px-1">
            <button onClick={onDelete} className="text-xs text-error hover:underline">
              Delete
            </button>
          </div>
        )}
      </div>

      <div ref={setNodeRef} className={`flex-1 space-y-1.5 p-2 ${isOver ? "bg-blue-50" : ""}`} style={{ minHeight: 220 }}>
        {placed.map((p) => (
          <div key={p.id} className="rounded-lg border border-surface-container-high bg-surface-container-low p-2 text-xs">
            <div className="flex items-start justify-between gap-1">
              <p className="font-medium text-on-surface">{p.feeder.name}</p>
              {!readOnly && (
                <button onClick={() => onRemove(p.id)} title="Move back to available feeders" className="text-error hover:underline">
                  ✕
                </button>
              )}
            </div>
            <p className="text-[10px] text-on-surface-variant">{p.feeder.rating_summary || p.feeder.category || "—"}</p>
          </div>
        ))}
        {placed.length === 0 && <p className="pt-6 text-center text-xs text-on-surface-variant">Drop feeders here</p>}
      </div>
    </div>
  );
}
