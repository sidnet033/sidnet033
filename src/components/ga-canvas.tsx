"use client";

import { useMemo, useState } from "react";
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
import type { BayType, ItemMaster, PlacedFeeder, Vertical } from "@/types/database";
import type { VerticalWithFeeders } from "@/app/(app)/switchboards/[id]/ga/page";
import { SwitchboardHeaderBar } from "@/components/switchboard-header-bar";
import type { LockState } from "@/components/revision-lock-controls";
import { AdHocFeederPanel } from "@/components/ad-hoc-feeder-panel";
import { findDuplicateLibraryFeeder } from "@/lib/feeder-duplicate";
import { Icon } from "@/components/icon";
import type { SwitchboardContext } from "@/lib/switchboard-context";

type FeederWithCost = VerticalWithFeeders["placed"][number]["feeder"];
type PlacedWithFeeder = VerticalWithFeeders["placed"][number];

const BAY_TEMPLATES: { bay_type: BayType; label: string; namePrefix: string }[] = [
  { bay_type: "incomer", label: "+ Incomer Bay", namePrefix: "Incomer" },
  { bay_type: "outgoing", label: "+ Outgoing Bay", namePrefix: "Outgoing" },
  { bay_type: "riser", label: "+ Cable Spreader", namePrefix: "Riser" },
  { bay_type: "bus_coupler", label: "+ Bus Coupler", namePrefix: "Bus Coupler" },
];

const FORM_OPTIONS = ["Form 1", "Form 2a", "Form 2b", "Form 3a", "Form 3b", "Form 4a", "Form 4b (Type 7)"];
const PLINTH_OPTIONS = [75, 100, 150, 200];
const PANEL_HEIGHT_OPTIONS = [1800, 2000, 2100, 2200];

export function GaCanvas({
  ctx,
  initialVerticals,
  feederLibrary,
  allItems,
  currentUserId,
  currentUserName,
  isAdmin,
  enclosureCost,
}: {
  ctx: SwitchboardContext;
  initialVerticals: VerticalWithFeeders[];
  feederLibrary: FeederWithCost[];
  allItems: ItemMaster[];
  currentUserId: string;
  currentUserName: string | null;
  isAdmin: boolean;
  enclosureCost: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  const sb = ctx.switchboard;

  const [formOfSeparation, setFormOfSeparation] = useState(sb.form_of_separation ?? "");
  const [plinthHeight, setPlinthHeight] = useState(sb.plinth_height_mm ?? 100);
  const [panelHeight, setPanelHeight] = useState(sb.panel_height_mm ?? 2100);
  const [amps, setAmps] = useState(sb.amps ?? "");
  const [ka, setKa] = useState(sb.ka ?? "");

  const [verticals, setVerticals] = useState<VerticalWithFeeders[]>(initialVerticals);
  const [library, setLibrary] = useState<FeederWithCost[]>(feederLibrary);
  const [search, setSearch] = useState("");
  const [draggingFeeder, setDraggingFeeder] = useState<FeederWithCost | null>(null);
  const [lockState, setLockState] = useState<LockState>({
    locked_by: ctx.revision.locked_by,
    archived: ctx.revision.archived,
  });

  const readOnly = lockState.archived || (lockState.locked_by !== null && lockState.locked_by !== currentUserId);

  const bays = verticals.filter((v) => v.bay_type !== "unassigned").sort((a, b) => a.sort_order - b.sort_order);
  const unallocated = verticals.find((v) => v.bay_type === "unassigned") ?? null;
  const totalWidth = bays.reduce((s, v) => s + (v.width_mm ?? 0), 0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const filteredLibrary = library.filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      (f.category ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function saveMasterParam(field: string, value: string | number | null) {
    await supabase.from("switchboards").update({ [field]: value }).eq("id", sb.id);
  }

  async function addBay(template: (typeof BAY_TEMPLATES)[number]) {
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
    if (!confirm("Delete this bay and everything placed in it?")) return;
    setVerticals(verticals.filter((v) => v.id !== id));
    await supabase.from("verticals").delete().eq("id", id);
  }

  async function allocateExisting(placedId: string, fromVerticalId: string, toVerticalId: string) {
    const fromVertical = verticals.find((v) => v.id === fromVerticalId);
    const placedRow = fromVertical?.placed.find((p) => p.id === placedId);
    if (!placedRow) return;

    setVerticals(
      verticals.map((v) => {
        if (v.id === fromVerticalId) return { ...v, placed: v.placed.filter((p) => p.id !== placedId) };
        if (v.id === toVerticalId) return { ...v, placed: [...v.placed, { ...placedRow, tier_number: 1 }] };
        return v;
      })
    );
    await supabase.from("placed_feeders").update({ vertical_id: toVerticalId, tier_number: 1 }).eq("id", placedId);
  }

  async function addFeederToBay(verticalId: string, feeder: FeederWithCost) {
    const vertical = verticals.find((v) => v.id === verticalId);
    if (!vertical) return;

    const { data, error } = await supabase
      .from("placed_feeders")
      .insert({ vertical_id: verticalId, feeder_id: feeder.id, qty: 1, sort_order: vertical.placed.length, tier_number: 1 })
      .select("*")
      .single();
    if (error) return alert(error.message);

    const placedRow = { ...(data as PlacedFeeder), feeder } as PlacedWithFeeder;
    setVerticals(verticals.map((v) => (v.id === verticalId ? { ...v, placed: [...v.placed, placedRow] } : v)));
  }

  async function updatePlacedTier(verticalId: string, placedId: string, tier: number) {
    setVerticals(
      verticals.map((v) =>
        v.id === verticalId ? { ...v, placed: v.placed.map((p) => (p.id === placedId ? { ...p, tier_number: tier } : p)) } : v
      )
    );
    await supabase.from("placed_feeders").update({ tier_number: tier }).eq("id", placedId);
  }

  async function updatePlacedQty(verticalId: string, placedId: string, qty: number) {
    setVerticals(
      verticals.map((v) =>
        v.id === verticalId ? { ...v, placed: v.placed.map((p) => (p.id === placedId ? { ...p, qty } : p)) } : v
      )
    );
    await supabase.from("placed_feeders").update({ qty }).eq("id", placedId);
  }

  async function removePlaced(verticalId: string, placedId: string) {
    setVerticals(verticals.map((v) => (v.id === verticalId ? { ...v, placed: v.placed.filter((p) => p.id !== placedId) } : v)));
    await supabase.from("placed_feeders").delete().eq("id", placedId);
  }

  async function promoteToLibrary(feeder: FeederWithCost) {
    const { data: feederItemRows } = await supabase.from("feeder_items").select("item_id").eq("feeder_id", feeder.id);
    const itemIds = ((feederItemRows ?? []) as { item_id: string }[]).map((r) => r.item_id);

    const duplicate = await findDuplicateLibraryFeeder(supabase, itemIds, feeder.id);
    if (duplicate) {
      alert(`A feeder with the same items already exists in the Feeder Library: "${duplicate.name}". Not creating a duplicate.`);
      return;
    }

    const { error } = await supabase.from("feeders").update({ is_library: true }).eq("id", feeder.id);
    if (error) {
      alert(error.message);
      return;
    }
    setLibrary(library.map((f) => (f.id === feeder.id ? { ...f, is_library: true } : f)));
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("lib-")) {
      const feederId = id.replace("lib-", "");
      setDraggingFeeder(library.find((f) => f.id === feederId) ?? null);
    } else if (id.startsWith("unalloc-")) {
      const placedId = id.replace("unalloc-", "");
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

    if (activeId.startsWith("lib-")) {
      const feederId = activeId.replace("lib-", "");
      const feeder = library.find((f) => f.id === feederId);
      if (feeder) addFeederToBay(verticalId, feeder);
    } else if (activeId.startsWith("unalloc-") && unallocated) {
      const placedId = activeId.replace("unalloc-", "");
      allocateExisting(placedId, unallocated.id, verticalId);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-[calc(100vh-56px)] flex-col">
        <SwitchboardHeaderBar
          ctx={ctx}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          isAdmin={isAdmin}
          lockState={lockState}
          onStateChange={setLockState}
        />

        <div className="flex flex-wrap items-end gap-4 border-b border-slate-200/90 bg-slate-50/60 px-4 py-2.5 text-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Switchboard Master Parameters</p>
          <Field label="Plinth Height">
            <select
              disabled={readOnly}
              value={plinthHeight}
              onChange={(e) => {
                setPlinthHeight(Number(e.target.value));
                saveMasterParam("plinth_height_mm", Number(e.target.value));
              }}
              className="rounded border border-slate-300 px-1.5 py-1"
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
              className="rounded border border-slate-300 px-1.5 py-1"
            >
              {PANEL_HEIGHT_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}mm
                </option>
              ))}
            </select>
          </Field>
          <Field label="Form of Separation">
            <select
              disabled={readOnly}
              value={formOfSeparation}
              onChange={(e) => {
                setFormOfSeparation(e.target.value);
                saveMasterParam("form_of_separation", e.target.value || null);
              }}
              className="rounded border border-slate-300 px-1.5 py-1"
            >
              <option value="">—</option>
              {FORM_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amps">
            <input
              disabled={readOnly}
              type="number"
              value={amps}
              onChange={(e) => setAmps(e.target.value ? Number(e.target.value) : "")}
              onBlur={() => saveMasterParam("amps", amps === "" ? null : Number(amps))}
              className="w-20 rounded border border-slate-300 px-1.5 py-1"
            />
          </Field>
          <Field label="kA">
            <input
              disabled={readOnly}
              type="number"
              value={ka}
              onChange={(e) => setKa(e.target.value ? Number(e.target.value) : "")}
              onBlur={() => saveMasterParam("ka", ka === "" ? null : Number(ka))}
              className="w-16 rounded border border-slate-300 px-1.5 py-1"
            />
          </Field>
          <button
            onClick={() => alert("Export (DXF / DWG / PDF) is coming in a later phase.")}
            className="ml-auto flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            <Icon name="download" size={14} /> Export GA
          </button>
        </div>

        <div className="flex flex-1 gap-4 overflow-hidden p-4">
          <aside className="w-72 shrink-0 overflow-y-auto rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs">
            {unallocated && unallocated.placed.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
                  Unallocated ({unallocated.placed.length})
                </p>
                <div className="space-y-2">
                  {unallocated.placed.map((p) => (
                    <UnallocatedCard key={p.id} placed={p} disabled={readOnly} />
                  ))}
                </div>
              </div>
            )}

            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Feeder Master</p>
            {!readOnly && (
              <AdHocFeederPanel
                switchboardId={sb.id}
                allItems={allItems}
                onCreated={(f) => setLibrary([...library, f])}
              />
            )}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search feeders..."
              className="mb-3 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <p className="mb-2 text-xs text-slate-400">
              {readOnly ? "Read only — lock this revision to edit." : "Drag a feeder onto a bay →"}
            </p>
            <div className="space-y-2">
              {filteredLibrary.map((f) => (
                <LibraryFeederCard
                  key={f.id}
                  feeder={f}
                  disabled={readOnly}
                  onPromote={!readOnly && !f.is_library ? () => promoteToLibrary(f) : undefined}
                />
              ))}
              {filteredLibrary.length === 0 && <p className="text-sm text-slate-400">No feeders. Build your feeder master first.</p>}
            </div>
          </aside>

          <div className="flex flex-1 flex-col overflow-hidden">
            {!readOnly && (
              <div className="mb-3 flex flex-wrap gap-2">
                {BAY_TEMPLATES.map((t) => (
                  <button
                    key={t.bay_type}
                    onClick={() => addBay(t)}
                    className="rounded-md border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-brand-500/60 hover:text-brand-600"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-x-auto rounded-xl border border-slate-200/90 bg-slate-50/40 p-3">
              {bays.length > 0 && (
                <div
                  className="mb-2 flex items-center justify-center rounded-t-lg border border-b-0 border-amber-300/60 bg-amber-50 py-2 text-[11px] font-medium text-amber-800"
                  style={{ minWidth: bays.length * 220 }}
                >
                  Busbar Chamber{amps ? ` · ${amps}A` : ""}
                  {ka ? ` · ${ka}kA` : ""} Cu Horizontal Busbar
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
                    onQtyChange={(placedId, qty) => updatePlacedQty(v.id, placedId, qty)}
                    onTierChange={(placedId, tier) => updatePlacedTier(v.id, placedId, tier)}
                    onRemove={(placedId) => removePlaced(v.id, placedId)}
                  />
                ))}
                {bays.length === 0 && (
                  <p className="w-full py-10 text-center text-sm text-slate-400">
                    No bays yet — add one from the Modular Bay Templates above.
                  </p>
                )}
              </div>
              {bays.length > 0 && (
                <div
                  className="mt-2 flex items-center justify-center gap-4 rounded-b-lg border border-t-0 border-slate-300 bg-slate-200/70 py-2 text-[11px] font-medium text-slate-600"
                  style={{ minWidth: bays.length * 220 }}
                >
                  <Icon name="anchor" size={13} /> Base Plinth ({plinthHeight}mm) <Icon name="anchor" size={13} />
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200/90 bg-white px-4 py-2.5 text-sm shadow-xs">
              <span className="text-slate-500">
                Enclosure Cost: <span className="font-semibold text-slate-900">₹{enclosureCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
              </span>
              <a href={`/switchboards/${sb.id}/bom`} className="font-medium text-brand-600 hover:underline">
                Open BOM Builder →
              </a>
            </div>
          </div>
        </div>
      </div>

      <DragOverlay>
        {draggingFeeder && (
          <div className="w-56 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-lg">
            <p className="font-medium text-slate-900">{draggingFeeder.name}</p>
            <p className="text-xs text-slate-400">₹{draggingFeeder.cost.toLocaleString("en-IN")}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-slate-500">
      {label}
      {children}
    </label>
  );
}

function UnallocatedCard({ placed, disabled }: { placed: PlacedWithFeeder; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `unalloc-${placed.id}`,
    disabled,
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm ${
        disabled ? "opacity-60" : `cursor-grab active:cursor-grabbing ${isDragging ? "opacity-40" : "hover:border-amber-400"}`
      }`}
    >
      <p className="truncate font-medium text-slate-800">{placed.feeder.name}</p>
      <p className="text-xs text-slate-400">₹{placed.feeder.cost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
    </div>
  );
}

function LibraryFeederCard({
  feeder,
  disabled = false,
  onPromote,
}: {
  feeder: FeederWithCost;
  disabled?: boolean;
  onPromote?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `lib-${feeder.id}`,
    disabled,
  });

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`rounded-lg border border-slate-200 px-3 py-2 text-sm ${
        disabled ? "opacity-60" : `cursor-grab active:cursor-grabbing ${isDragging ? "opacity-40" : "hover:border-brand-500/60"}`
      }`}
    >
      <div className="flex items-center gap-1.5">
        <p className="flex-1 truncate font-medium text-slate-800">{feeder.name}</p>
        {!feeder.is_library && (
          <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] text-slate-500">
            Board
          </span>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{feeder.category || "—"}</span>
        <span>₹{feeder.cost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
      </div>
      {onPromote && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onPromote}
          className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:underline"
        >
          <Icon name="upload" size={12} /> Save to Feeder Library
        </button>
      )}
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
  onQtyChange,
  onTierChange,
  onRemove,
}: {
  vertical: VerticalWithFeeders;
  readOnly: boolean;
  totalWidth: number;
  onRename: (name: string) => void;
  onDimChange: (field: "width_mm" | "depth_mm", value: string) => void;
  onDelete: () => void;
  onQtyChange: (placedId: string, qty: number) => void;
  onTierChange: (placedId: string, tier: number) => void;
  onRemove: (placedId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bay-${vertical.id}`, disabled: readOnly });
  const [localName, setLocalName] = useState(vertical.name);
  const [localWidth, setLocalWidth] = useState(vertical.width_mm ? String(vertical.width_mm) : "");
  const [localDepth, setLocalDepth] = useState(vertical.depth_mm ? String(vertical.depth_mm) : "");

  const subtotal = vertical.placed.reduce((sum, p) => sum + p.qty * p.feeder.cost, 0);
  const widthPct = totalWidth > 0 && vertical.width_mm ? Math.round((vertical.width_mm / totalWidth) * 100) : null;

  const tiers = Array.from(new Set(vertical.placed.map((p) => p.tier_number))).sort((a, b) => a - b);

  return (
    <div className="flex w-56 shrink-0 flex-col rounded-xl border border-slate-200/90 bg-white shadow-xs">
      <div className="border-b border-slate-100 p-2">
        <div className="flex items-center justify-between">
          <input
            value={localName}
            disabled={readOnly}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={() => onRename(localName)}
            className="w-full rounded border-none bg-transparent px-1 py-0.5 text-sm font-semibold text-slate-900 focus:bg-slate-50 disabled:text-slate-500"
          />
          {vertical.bay_type && (
            <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] capitalize text-slate-500">
              {vertical.bay_type.replace("_", " ")}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5 px-1 text-xs text-slate-400">
          <input
            type="number"
            value={localWidth}
            disabled={readOnly}
            onChange={(e) => setLocalWidth(e.target.value)}
            onBlur={() => onDimChange("width_mm", localWidth)}
            placeholder="W"
            className="w-14 rounded border border-slate-200 px-1 py-0.5 disabled:bg-slate-50"
          />
          ×
          <input
            type="number"
            value={localDepth}
            disabled={readOnly}
            onChange={(e) => setLocalDepth(e.target.value)}
            onBlur={() => onDimChange("depth_mm", localDepth)}
            placeholder="D"
            className="w-14 rounded border border-slate-200 px-1 py-0.5 disabled:bg-slate-50"
          />
          <span>mm{widthPct !== null && ` · ${widthPct}%`}</span>
        </div>
        {!readOnly && (
          <div className="mt-1 px-1">
            <button onClick={onDelete} className="text-xs text-rose-600 hover:underline">
              Delete
            </button>
          </div>
        )}
      </div>

      <div ref={setNodeRef} className={`flex-1 space-y-3 p-2 ${isOver ? "bg-blue-50" : ""}`} style={{ minHeight: 220 }}>
        {tiers.map((tier) => (
          <div key={tier} className="rounded-lg border border-dashed border-slate-200 p-1.5">
            <p className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Tier {tier}</p>
            <div className="space-y-1.5">
              {vertical.placed
                .filter((p) => p.tier_number === tier)
                .map((p) => (
                  <div key={p.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                    <div className="flex items-start justify-between gap-1">
                      <p className="font-medium text-slate-800">{p.feeder.name}</p>
                      {!readOnly && (
                        <button onClick={() => onRemove(p.id)} className="text-rose-500 hover:underline">
                          ✕
                        </button>
                      )}
                    </div>
                    {p.feeder.rating_summary && <p className="text-[10px] text-slate-400">{p.feeder.rating_summary}</p>}
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1">
                        <label className="text-slate-500">Qty</label>
                        <input
                          type="number"
                          min="1"
                          value={p.qty}
                          disabled={readOnly}
                          onChange={(e) => onQtyChange(p.id, Number(e.target.value) || 1)}
                          className="w-10 rounded border border-slate-200 px-1 py-0.5 disabled:bg-slate-100"
                        />
                        <label className="text-slate-500">Tier</label>
                        <input
                          type="number"
                          min="1"
                          value={p.tier_number}
                          disabled={readOnly}
                          onChange={(e) => onTierChange(p.id, Number(e.target.value) || 1)}
                          className="w-10 rounded border border-slate-200 px-1 py-0.5 disabled:bg-slate-100"
                        />
                      </div>
                      <span className="tabular-nums text-slate-500">
                        ₹{(p.qty * p.feeder.cost).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
        {vertical.placed.length === 0 && <p className="pt-6 text-center text-xs text-slate-300">Drop feeders here</p>}
      </div>

      <div className="border-t border-slate-100 p-2 text-right text-xs font-medium text-slate-600">
        ₹{subtotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
      </div>
    </div>
  );
}
