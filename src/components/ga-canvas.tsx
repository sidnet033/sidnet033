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
import type { PlacedFeeder, Project, Vertical } from "@/types/database";
import type { VerticalWithFeeders } from "@/app/(app)/projects/[id]/ga/page";

type FeederWithCost = VerticalWithFeeders["placed"][number]["feeder"];
type PlacedWithFeeder = VerticalWithFeeders["placed"][number];

export function GaCanvas({
  project,
  initialVerticals,
  feederLibrary,
}: {
  project: Project;
  initialVerticals: VerticalWithFeeders[];
  feederLibrary: FeederWithCost[];
}) {
  const supabase = useMemo(() => createClient(), []);

  const [name, setName] = useState(project.name);
  const [customer, setCustomer] = useState(project.customer_name ?? "");
  const [status, setStatus] = useState(project.status);
  const [verticals, setVerticals] = useState<VerticalWithFeeders[]>(initialVerticals);
  const [search, setSearch] = useState("");
  const [draggingFeeder, setDraggingFeeder] = useState<FeederWithCost | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const filteredLibrary = feederLibrary.filter(
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

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("lib-")) {
      const feederId = id.replace("lib-", "");
      setDraggingFeeder(feederLibrary.find((f) => f.id === feederId) ?? null);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingFeeder(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith("lib-") && overId.startsWith("vert-")) {
      const feederId = activeId.replace("lib-", "");
      const verticalId = overId.replace("vert-", "");
      const feeder = feederLibrary.find((f) => f.id === feederId);
      if (feeder) addFeederToVertical(verticalId, feeder);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-[calc(100vh-64px)] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => saveProjectField("name", name)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm font-medium"
            />
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              onBlur={() => saveProjectField("customer_name", customer)}
              placeholder="Customer"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as Project["status"]);
                saveProjectField("status", e.target.value);
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="draft">draft</option>
              <option value="quoted">quoted</option>
              <option value="won">won</option>
              <option value="lost">lost</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-slate-500 hover:underline">
              ← All projects
            </Link>
            <Link
              href={`/projects/${project.id}/costing`}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              View costing →
            </Link>
          </div>
        </div>

        <div className="flex flex-1 gap-4 overflow-hidden">
          <aside className="w-72 shrink-0 overflow-y-auto rounded-md border border-slate-200 bg-white p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Feeder library</p>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search feeders..."
              className="mb-3 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <p className="mb-2 text-xs text-slate-400">Drag a feeder onto a vertical →</p>
            <div className="space-y-2">
              {filteredLibrary.map((f) => (
                <LibraryFeederCard key={f.id} feeder={f} />
              ))}
              {filteredLibrary.length === 0 && (
                <p className="text-sm text-slate-400">
                  No feeders. Build your feeder library first.
                </p>
              )}
            </div>
          </aside>

          <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
            {verticals.map((v) => (
              <VerticalColumn
                key={v.id}
                vertical={v}
                onRename={(newName) => renameVertical(v.id, newName)}
                onWidthChange={(w) => setVerticalWidth(v.id, w)}
                onDelete={() => deleteVertical(v.id)}
                onQtyChange={(placedId, qty) => updatePlacedQty(v.id, placedId, qty)}
                onMove={(placedId, dir) => movePlaced(v.id, placedId, dir)}
                onRemove={(placedId) => removePlaced(v.id, placedId)}
              />
            ))}
            <button
              onClick={addVertical}
              className="flex h-fit w-48 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-slate-300 py-8 text-sm font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700"
            >
              + Add vertical
            </button>
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

function LibraryFeederCard({ feeder }: { feeder: FeederWithCost }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `lib-${feeder.id}`,
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
      className={`cursor-grab rounded-md border border-slate-200 px-3 py-2 text-sm active:cursor-grabbing ${
        isDragging ? "opacity-40" : "hover:border-slate-400"
      }`}
    >
      <p className="font-medium text-slate-800">{feeder.name}</p>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{feeder.category || "—"}</span>
        <span>₹{feeder.cost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
      </div>
    </div>
  );
}

function VerticalColumn({
  vertical,
  onRename,
  onWidthChange,
  onDelete,
  onQtyChange,
  onMove,
  onRemove,
}: {
  vertical: VerticalWithFeeders;
  onRename: (name: string) => void;
  onWidthChange: (width: string) => void;
  onDelete: () => void;
  onQtyChange: (placedId: string, qty: number) => void;
  onMove: (placedId: string, dir: -1 | 1) => void;
  onRemove: (placedId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `vert-${vertical.id}` });
  const [localName, setLocalName] = useState(vertical.name);
  const [localWidth, setLocalWidth] = useState(vertical.width_mm ? String(vertical.width_mm) : "");

  const subtotal = vertical.placed.reduce((sum, p) => sum + p.qty * p.feeder.cost, 0);

  return (
    <div className="flex w-64 shrink-0 flex-col rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-2">
        <input
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={() => onRename(localName)}
          className="w-full rounded border-none bg-transparent px-1 py-0.5 text-sm font-semibold text-slate-900 focus:bg-slate-50"
        />
        <div className="mt-1 flex items-center justify-between px-1">
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <input
              type="number"
              value={localWidth}
              onChange={(e) => setLocalWidth(e.target.value)}
              onBlur={() => onWidthChange(localWidth)}
              placeholder="width"
              className="w-14 rounded border border-slate-200 px-1 py-0.5 text-xs"
            />
            <span>mm</span>
          </div>
          <button onClick={onDelete} className="text-xs text-red-500 hover:underline">
            Delete
          </button>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2 p-2 ${isOver ? "bg-blue-50" : ""}`}
        style={{ minHeight: 200 }}
      >
        {vertical.placed.map((p, i) => (
          <div key={p.id} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
            <div className="flex items-start justify-between gap-1">
              <p className="font-medium text-slate-800">{p.feeder.name}</p>
              <button onClick={() => onRemove(p.id)} className="text-red-500 hover:underline">
                ✕
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button onClick={() => onMove(p.id, -1)} disabled={i === 0} className="text-slate-400 disabled:opacity-30">
                  ↑
                </button>
                <button
                  onClick={() => onMove(p.id, 1)}
                  disabled={i === vertical.placed.length - 1}
                  className="text-slate-400 disabled:opacity-30"
                >
                  ↓
                </button>
                <label className="ml-1 text-slate-500">Qty</label>
                <input
                  type="number"
                  min="1"
                  value={p.qty}
                  onChange={(e) => onQtyChange(p.id, Number(e.target.value) || 1)}
                  className="w-12 rounded border border-slate-200 px-1 py-0.5"
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

