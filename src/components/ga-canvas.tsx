"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import type { ItemMaster, PlacedFeeder, Project, Vertical } from "@/types/database";
import type { SiblingRevision, VerticalWithFeeders } from "@/app/(app)/projects/[id]/ga/page";
import { ProjectLockControls, type LockState } from "@/components/project-lock-controls";
import { AdHocFeederPanel } from "@/components/ad-hoc-feeder-panel";
import { findDuplicateLibraryFeeder } from "@/lib/feeder-duplicate";
import { Icon } from "@/components/icon";

type FeederWithCost = VerticalWithFeeders["placed"][number]["feeder"];
type PlacedWithFeeder = VerticalWithFeeders["placed"][number];

export function GaCanvas({
  project,
  initialVerticals,
  feederLibrary,
  allItems,
  currentUserId,
  currentUserName,
  isAdmin,
  lockedByName,
  siblingRevisions,
}: {
  project: Project;
  initialVerticals: VerticalWithFeeders[];
  feederLibrary: FeederWithCost[];
  allItems: ItemMaster[];
  currentUserId: string;
  currentUserName: string | null;
  isAdmin: boolean;
  lockedByName: string | null;
  siblingRevisions: SiblingRevision[];
}) {
  const supabase = useMemo(() => createClient(), []);

  const [name, setName] = useState(project.name);
  const [customer, setCustomer] = useState(project.customer_name ?? "");
  const [status, setStatus] = useState(project.status);
  const [verticals, setVerticals] = useState<VerticalWithFeeders[]>(initialVerticals);
  const [library, setLibrary] = useState<FeederWithCost[]>(feederLibrary);
  const [search, setSearch] = useState("");
  const [draggingFeeder, setDraggingFeeder] = useState<FeederWithCost | null>(null);
  const [lockState, setLockState] = useState<LockState>({
    locked_by: project.locked_by,
    archived: project.archived,
  });

  const readOnly = lockState.archived || (lockState.locked_by !== null && lockState.locked_by !== currentUserId);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const filteredLibrary = library.filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      (f.category ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function saveProjectField(field: "name" | "customer_name" | "status", value: string) {
    await supabase.from("projects").update({ [field]: value, updated_at: new Date().toISOString() }).eq("id", project.id);
  }

  async function addVertical() {
    const { data, error } = await supabase
      .from("verticals")
      .insert({ project_id: project.id, name: `Vertical ${verticals.length + 1}`, sort_order: verticals.length })
      .select("*")
      .single();
    if (error) return alert(error.message);
    setVerticals([...verticals, { ...(data as Vertical), placed: [] }]);
  }

  async function renameVertical(id: string, newName: string) {
    setVerticals(verticals.map((v) => (v.id === id ? { ...v, name: newName } : v)));
    await supabase.from("verticals").update({ name: newName }).eq("id", id);
  }

  async function setVerticalWidth(id: string, width: string) {
    const num = width ? Number(width) : null;
    setVerticals(verticals.map((v) => (v.id === id ? { ...v, width_mm: num } : v)));
    await supabase.from("verticals").update({ width_mm: num }).eq("id", id);
  }

  async function deleteVertical(id: string) {
    if (!confirm("Delete this vertical and everything placed in it?")) return;
    setVerticals(verticals.filter((v) => v.id !== id));
    await supabase.from("verticals").delete().eq("id", id);
  }

  async function addFeederToVertical(verticalId: string, feeder: FeederWithCost) {
    const vertical = verticals.find((v) => v.id === verticalId);
    if (!vertical) return;

    const { data, error } = await supabase
      .from("placed_feeders")
      .insert({ vertical_id: verticalId, feeder_id: feeder.id, qty: 1, sort_order: vertical.placed.length })
      .select("*")
      .single();
    if (error) return alert(error.message);

    const placedRow = { ...(data as PlacedFeeder), feeder } as PlacedWithFeeder;
    setVerticals(
      verticals.map((v) => (v.id === verticalId ? { ...v, placed: [...v.placed, placedRow] } : v))
    );
  }

  async function updatePlacedQty(verticalId: string, placedId: string, qty: number) {
    setVerticals(
      verticals.map((v) =>
        v.id === verticalId
          ? { ...v, placed: v.placed.map((p) => (p.id === placedId ? { ...p, qty } : p)) }
          : v
      )
    );
    await supabase.from("placed_feeders").update({ qty }).eq("id", placedId);
  }

  async function movePlaced(verticalId: string, placedId: string, direction: -1 | 1) {
    const vertical = verticals.find((v) => v.id === verticalId);
    if (!vertical) return;
    const idx = vertical.placed.findIndex((p) => p.id === placedId);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= vertical.placed.length) return;

    const reordered = [...vertical.placed];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];

    setVerticals(verticals.map((v) => (v.id === verticalId ? { ...v, placed: reordered } : v)));

    await Promise.all(
      reordered.map((p, i) => supabase.from("placed_feeders").update({ sort_order: i }).eq("id", p.id))
    );
  }

  async function removePlaced(verticalId: string, placedId: string) {
    setVerticals(
      verticals.map((v) => (v.id === verticalId ? { ...v, placed: v.placed.filter((p) => p.id !== placedId) } : v))
    );
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
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingFeeder(null);
    const { active, over } = event;
    if (!over || readOnly) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith("lib-") && overId.startsWith("vert-")) {
      const feederId = activeId.replace("lib-", "");
      const verticalId = overId.replace("vert-", "");
      const feeder = library.find((f) => f.id === feederId);
      if (feeder) addFeederToVertical(verticalId, feeder);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-[calc(100vh-56px)] flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => saveProjectField("name", name)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm font-medium focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500"
            />
            <input
              value={customer}
              disabled={readOnly}
              onChange={(e) => setCustomer(e.target.value)}
              onBlur={() => saveProjectField("customer_name", customer)}
              placeholder="Customer"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500"
            />
            <select
              value={status}
              disabled={readOnly}
              onChange={(e) => {
                setStatus(e.target.value as Project["status"]);
                saveProjectField("status", e.target.value);
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-500"
            >
              <option value="draft">draft</option>
              <option value="quoted">quoted</option>
              <option value="won">won</option>
              <option value="lost">lost</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-slate-500 hover:underline">
              ← Dashboard
            </Link>
            <Link
              href={`/projects/${project.id}/costing`}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              View costing →
            </Link>
          </div>
        </div>

        <ProjectLockControls
          projectId={project.id}
          initialLockedBy={project.locked_by}
          initialLockedByName={lockedByName}
          initialArchived={project.archived}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          isAdmin={isAdmin}
          createdBy={project.created_by}
          revisionNumber={project.revision_number}
          siblingRevisions={siblingRevisions}
          onStateChange={setLockState}
        />

        {readOnly && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
            <Icon name="visibility" size={15} />
            {lockState.archived
              ? "This project is archived — read only."
              : "Locked by another user — you can look around, but editing is off until it's released."}
          </div>
        )}

        <div className="flex flex-1 gap-4 overflow-hidden">
          <aside className="w-72 shrink-0 overflow-y-auto rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Feeder Master</p>
            {!readOnly && (
              <AdHocFeederPanel
                projectId={project.id}
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
              {readOnly ? "Read only — lock this project to edit." : "Drag a feeder onto a vertical →"}
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
              {filteredLibrary.length === 0 && (
                <p className="text-sm text-slate-400">
                  No feeders. Build your feeder master first.
                </p>
              )}
            </div>
          </aside>

          <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
            {verticals.map((v) => (
              <VerticalColumn
                key={v.id}
                vertical={v}
                readOnly={readOnly}
                onRename={(newName) => renameVertical(v.id, newName)}
                onWidthChange={(w) => setVerticalWidth(v.id, w)}
                onDelete={() => deleteVertical(v.id)}
                onQtyChange={(placedId, qty) => updatePlacedQty(v.id, placedId, qty)}
                onMove={(placedId, dir) => movePlaced(v.id, placedId, dir)}
                onRemove={(placedId) => removePlaced(v.id, placedId)}
              />
            ))}
            {!readOnly && (
              <button
                onClick={addVertical}
                className="flex h-fit w-48 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-slate-300 py-8 text-sm font-medium text-slate-500 hover:border-brand-500/60 hover:text-brand-600"
              >
                + Add vertical
              </button>
            )}
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

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`rounded-lg border border-slate-200 px-3 py-2 text-sm ${
        disabled
          ? "opacity-60"
          : `cursor-grab active:cursor-grabbing ${isDragging ? "opacity-40" : "hover:border-brand-500/60"}`
      }`}
    >
      <div className="flex items-center gap-1.5">
        <p className="flex-1 truncate font-medium text-slate-800">{feeder.name}</p>
        {!feeder.is_library && (
          <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] text-slate-500">
            Project
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

function VerticalColumn({
  vertical,
  readOnly,
  onRename,
  onWidthChange,
  onDelete,
  onQtyChange,
  onMove,
  onRemove,
}: {
  vertical: VerticalWithFeeders;
  readOnly: boolean;
  onRename: (name: string) => void;
  onWidthChange: (width: string) => void;
  onDelete: () => void;
  onQtyChange: (placedId: string, qty: number) => void;
  onMove: (placedId: string, dir: -1 | 1) => void;
  onRemove: (placedId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `vert-${vertical.id}`, disabled: readOnly });
  const [localName, setLocalName] = useState(vertical.name);
  const [localWidth, setLocalWidth] = useState(vertical.width_mm ? String(vertical.width_mm) : "");

  const subtotal = vertical.placed.reduce((sum, p) => sum + p.qty * p.feeder.cost, 0);

  return (
    <div className="flex w-64 shrink-0 flex-col rounded-xl border border-slate-200/90 bg-white shadow-xs">
      <div className="border-b border-slate-100 p-2">
        <input
          value={localName}
          disabled={readOnly}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={() => onRename(localName)}
          className="w-full rounded border-none bg-transparent px-1 py-0.5 text-sm font-semibold text-slate-900 focus:bg-slate-50 disabled:text-slate-500"
        />
        <div className="mt-1 flex items-center justify-between px-1">
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <input
              type="number"
              value={localWidth}
              disabled={readOnly}
              onChange={(e) => setLocalWidth(e.target.value)}
              onBlur={() => onWidthChange(localWidth)}
              placeholder="width"
              className="w-14 rounded border border-slate-200 px-1 py-0.5 text-xs disabled:bg-slate-50"
            />
            <span>mm</span>
          </div>
          {!readOnly && (
            <button onClick={onDelete} className="text-xs text-rose-600 hover:underline">
              Delete
            </button>
          )}
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2 p-2 ${isOver ? "bg-blue-50" : ""}`}
        style={{ minHeight: 200 }}
      >
        {vertical.placed.map((p, i) => (
          <div key={p.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
            <div className="flex items-start justify-between gap-1">
              <p className="font-medium text-slate-800">{p.feeder.name}</p>
              {!readOnly && (
                <button onClick={() => onRemove(p.id)} className="text-rose-500 hover:underline">
                  ✕
                </button>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button onClick={() => onMove(p.id, -1)} disabled={readOnly || i === 0} className="text-slate-400 disabled:opacity-30">
                  ↑
                </button>
                <button
                  onClick={() => onMove(p.id, 1)}
                  disabled={readOnly || i === vertical.placed.length - 1}
                  className="text-slate-400 disabled:opacity-30"
                >
                  ↓
                </button>
                <label className="ml-1 text-slate-500">Qty</label>
                <input
                  type="number"
                  min="1"
                  value={p.qty}
                  disabled={readOnly}
                  onChange={(e) => onQtyChange(p.id, Number(e.target.value) || 1)}
                  className="w-12 rounded border border-slate-200 px-1 py-0.5 disabled:bg-slate-100"
                />
              </div>
              <span className="tabular-nums text-slate-500">
                ₹{(p.qty * p.feeder.cost).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        ))}
        {vertical.placed.length === 0 && (
          <p className="pt-6 text-center text-xs text-slate-300">Drop feeders here</p>
        )}
      </div>

      <div className="border-t border-slate-100 p-2 text-right text-xs font-medium text-slate-600">
        ₹{subtotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
      </div>
    </div>
  );
}

