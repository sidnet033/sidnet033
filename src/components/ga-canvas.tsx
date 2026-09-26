"use client";

import { useEffect, useMemo, useState } from "react";
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
import { ensureUnassignedVertical } from "@/lib/switchboard-bom";
import { Icon } from "@/components/icon";
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
  const [verticals, setVerticals] = useState<VerticalWithFeeders[]>([]);

  const [plinthHeight, setPlinthHeight] = useState(100);
  const [panelHeight, setPanelHeight] = useState(2100);

  const [search, setSearch] = useState("");
  const [draggingFeeder, setDraggingFeeder] = useState<Feeder | null>(null);

  async function refreshGaData() {
    const data = await loadGaData(supabase, switchboardId);
    if (!data) return;
    setSb(data.switchboard);
    setVerticals(data.verticals);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await loadGaData(supabase, switchboardId);
      if (cancelled || !data) return;
      setSb(data.switchboard);
      setVerticals(data.verticals);
      setPlinthHeight(data.switchboard.plinth_height_mm ?? 100);
      setPanelHeight(data.switchboard.panel_height_mm ?? 2100);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, switchboardId]);

  const readOnly = !sb || revisionArchived || (sb.locked_by !== null && sb.locked_by !== currentUserId);

  const bays = verticals.filter((v) => v.bay_type !== "unassigned").sort((a, b) => a.sort_order - b.sort_order);
  const unallocated = verticals.find((v) => v.bay_type === "unassigned") ?? null;
  const totalWidth = bays.reduce((s, v) => s + (v.width_mm ?? 0), 0);

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

  async function saveMasterParam(field: string, value: string | number | null) {
    if (!sb) return;
    await supabase.from("switchboards").update({ [field]: value }).eq("id", sb.id);
  }

  async function addBay(template: (typeof BAY_TEMPLATES)[number]) {
    if (!sb) return;
    const count = bays.filter((b) => b.bay_type === template.bay_type).length + 1;
    const { data, error } = await supabase
      .from("verticals")
      .insert({
        switchboard_id: sb.id,
        name: `${template.namePrefix} ${count}`,
        bay_type: template.bay_type,
        width_mm: 600,
        sort_order: bays.length,
      })
      .select("*")
      .single();
    if (error) return alert(error.message);
    setVerticals([...verticals, { ...(data as Vertical), placed: [] }]);
  }

  async function renameBay(id: string, newName: string) {
    setVerticals(verticals.map((v) => (v.id === id ? { ...v, name: newName } : v)));
    await supabase.from("verticals").update({ name: newName }).eq("id", id);
  }

  async function setBayDim(id: string, field: "width_mm" | "depth_mm", value: string) {
    const num = value ? Number(value) : null;
    setVerticals(verticals.map((v) => (v.id === id ? { ...v, [field]: num } : v)));
    await supabase.from("verticals").update({ [field]: num }).eq("id", id);
  }

  async function deleteBay(id: string) {
    if (!confirm("Delete this bay? Anything placed in it goes back to the available feeders list.")) return;
    if (!sb) return;
    const vertical = verticals.find((v) => v.id === id);
    if (vertical && vertical.placed.length > 0) {
      const unassignedId = await ensureUnassignedVertical(supabase, sb.id);
      await supabase
        .from("placed_feeders")
        .update({ vertical_id: unassignedId })
        .in("id", vertical.placed.map((p) => p.id));
    }
    await supabase.from("verticals").delete().eq("id", id);
    await refreshGaData();
  }

  async function addSpare() {
    if (!sb || readOnly) return;
    const name = window.prompt('Name this spare feeder (e.g. "Spare", "Future Outgoing")', "Spare");
    if (name === null) return;
    const trimmedName = name.trim() || "Spare";
    const qtyInput = window.prompt("How many spare units?", "1");
    const qty = Math.max(1, Math.round(Number(qtyInput) || 1));

    const { data: feederRow, error: feederError } = await supabase
      .from("feeders")
      .insert({ name: trimmedName, category: "Spare", switchboard_id: sb.id, is_library: false, created_by: currentUserId })
      .select("id")
      .single();
    if (feederError || !feederRow) return alert(feederError?.message ?? "Could not create spare feeder.");

    const unassignedId = await ensureUnassignedVertical(supabase, sb.id);
    const { error: placedError } = await supabase.from("placed_feeders").insert(
      Array.from({ length: qty }, (_, i) => ({
        vertical_id: unassignedId,
        feeder_id: (feederRow as { id: string }).id,
        qty: 1,
        sort_order: i,
        tier_number: 1,
      }))
    );
    if (placedError) return alert(placedError.message);

    await refreshGaData();
  }

  // A unit dropped from the available-feeders list moves exactly one unit
  // of that placement into the target bay -- splitting a qty>1 row in the
  // unassigned bucket if needed -- rather than moving the whole placement.
  async function allocateUnit(placedId: string, toVerticalId: string) {
    if (!unallocated) return;
    const placedRow = unallocated.placed.find((p) => p.id === placedId);
    if (!placedRow) return;
    const targetVertical = verticals.find((v) => v.id === toVerticalId);
    if (!targetVertical) return;
    const newSortOrder = targetVertical.placed.length;

    if (placedRow.qty <= 1) {
      setVerticals(
        verticals.map((v) => {
          if (v.id === unallocated.id) return { ...v, placed: v.placed.filter((p) => p.id !== placedId) };
          if (v.id === toVerticalId)
            return { ...v, placed: [...v.placed, { ...placedRow, vertical_id: toVerticalId, sort_order: newSortOrder }] };
          return v;
        })
      );
      const { error } = await supabase
        .from("placed_feeders")
        .update({ vertical_id: toVerticalId, sort_order: newSortOrder })
        .eq("id", placedId);
      if (error) {
        alert(error.message);
        await refreshGaData();
      }
      return;
    }

    const { data, error } = await supabase
      .from("placed_feeders")
      .insert({ vertical_id: toVerticalId, feeder_id: placedRow.feeder_id, qty: 1, sort_order: newSortOrder, tier_number: 1 })
      .select("*")
      .single();
    if (error) return alert(error.message);
    const newRow = { ...(data as PlacedFeeder), feeder: placedRow.feeder } as PlacedWithFeeder;

    setVerticals(
      verticals.map((v) => {
        if (v.id === unallocated.id)
          return { ...v, placed: v.placed.map((p) => (p.id === placedId ? { ...p, qty: p.qty - 1 } : p)) };
        if (v.id === toVerticalId) return { ...v, placed: [...v.placed, newRow] };
        return v;
      })
    );
    const { error: decError } = await supabase.from("placed_feeders").update({ qty: placedRow.qty - 1 }).eq("id", placedId);
    if (decError) {
      alert(decError.message);
      await refreshGaData();
    }
  }

  // "Removing" a feeder from a bay sends it back to the available-feeders
  // list instead of deleting it -- feeders (other than spares) belong to
  // the BOM, so GA only ever re-files their placement, never their
  // existence.
  async function removeFromBay(verticalId: string, placedId: string) {
    if (!sb) return;
    const vertical = verticals.find((v) => v.id === verticalId);
    const placedRow = vertical?.placed.find((p) => p.id === placedId);
    if (!placedRow) return;

    const unassignedId = await ensureUnassignedVertical(supabase, sb.id);

    setVerticals((prev) =>
      prev.map((v) => {
        if (v.id === verticalId) return { ...v, placed: v.placed.filter((p) => p.id !== placedId) };
        if (v.id === unassignedId) return { ...v, placed: [...v.placed, { ...placedRow, vertical_id: unassignedId }] };
        return v;
      })
    );
    const { error } = await supabase.from("placed_feeders").update({ vertical_id: unassignedId }).eq("id", placedId);
    if (error) {
      alert(error.message);
      await refreshGaData();
    }
  }

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

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container-high bg-surface-container-lowest px-margin-lg py-space-md">
          <h1 className="font-display text-headline-lg text-on-surface">
            GA Builder — {sb.tag}
            {sb.title ? `: ${sb.title}` : ""}
          </h1>
          <button
            disabled
            title="Export coming soon"
            className="flex items-center gap-1 rounded bg-surface-container-low px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant opacity-60"
          >
            <Icon name="ios_share" size={16} /> Export GA (DXF/DWG/PDF)
          </button>
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
              onChange={(e) => {
                setPlinthHeight(Number(e.target.value));
                saveMasterParam("plinth_height_mm", Number(e.target.value));
              }}
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
              onChange={(e) => {
                setPanelHeight(Number(e.target.value));
                saveMasterParam("panel_height_mm", Number(e.target.value));
              }}
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
          <aside className="w-72 shrink-0 overflow-y-auto rounded-xl border border-surface-container-high bg-surface-container-lowest p-3 shadow-xs">
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
              {bays.length > 0 && (
                <div
                  className="mb-2 flex items-center justify-center rounded-t-lg border border-b-0 border-amber-300/60 bg-amber-50 py-2 text-[11px] font-medium text-amber-800"
                  style={{ minWidth: bays.length * 220 }}
                >
                  Busbar Chamber{sb.amps ? ` · ${sb.amps}A` : ""}
                  {sb.ka ? ` · ${sb.ka}kA` : ""} Cu Horizontal Busbar
                </div>
              )}
              <div className="flex gap-3" style={{ minWidth: bays.length * 220 }}>
                {bays.map((v) => (
                  <BayColumn
                    key={v.id}
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
