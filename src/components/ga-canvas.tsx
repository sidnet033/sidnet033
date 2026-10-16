"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { createClient } from "@/lib/supabase/client";
import type { BayType, Feeder, PlacedFeeder, Switchboard, Vertical } from "@/types/database";
import { Icon } from "@/components/icon";
import { SavingOverlay } from "@/components/saving-overlay";
import { numericKeyGuard } from "@/lib/numeric-input";
import {
  ACB_2TIER_OUTGOING_E12,
  DEVICE_TYPE_LABELS,
  MCC_FRONT_ACCESS_PAIR,
  OUTGOING_MCC_BAY,
  lookupAcbBaySpec,
  suggestAcbFrame,
} from "@/lib/artuk-sizing";
import { bayFunctionOf, type BusbarOverride, type BusbarPlan, type BusbarSegment } from "@/lib/busbar-plan";
import {
  BUSBAR_CHAMBER_HEIGHT_MM,
  DEFAULT_BAY_DEPTH_MM,
  DEFAULT_COMPARTMENT_HEIGHT_MM,
  artukBaySize,
  blankCompartmentLabel,
  chamberPositionFor,
  compartmentHeightFor,
  computeCompartments,
  overridesFromRows,
  planForSwitchboard,
  type BusbarOverrideRow,
  type VerticalWithFeeders,
} from "@/lib/ga-layout";
import { BusbarFrontOverlay, BusbarSchedule, BusbarSegmentPanel, BusbarSideOverlay } from "@/components/ga-busbar-layer";

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

// Elevation drawing scale. BUSBAR_CHAMBER_HEIGHT_MM is only the default
// used when a switchboard has no busbar_chamber_height_mm set yet -- the
// user can select the busbar chamber in the drawing and edit its real height.
const DRAWING_TARGET_HEIGHT_PX = 520;
const MIN_PX_PER_MM = 0.12;
const MAX_PX_PER_MM = 0.6;
const RULER_WIDTH_PX = 44;
const VERTICAL_DIM_WIDTH_PX = 20;

function computePxPerMm(totalHeightMm: number): number {
  if (totalHeightMm <= 0) return MIN_PX_PER_MM;
  return Math.min(MAX_PX_PER_MM, Math.max(MIN_PX_PER_MM, DRAWING_TARGET_HEIGHT_PX / totalHeightMm));
}

// Smallest of a set of "nice" mm steps whose on-screen spacing stays
// readable at the current scale.
function niceTickStepMm(pxPerMm: number): number {
  const candidates = [25, 50, 100, 200, 250, 500, 1000, 2000];
  return candidates.find((step) => step * pxPerMm >= 28) ?? candidates[candidates.length - 1];
}

type HoverExtent = { topMm: number; heightMm: number; bayLeftMm: number; bayWidthMm: number; label: string } | null;

// Plain-language explanation of why THIS bay currently has the
// width/depth it has -- read directly off the same ArTuK sizing lookups
// Auto-generate GA uses, so it stays accurate for auto-generated bays and
// still useful (naming what a manual bay is missing) for hand-built ones.
function explainBay(v: VerticalWithFeeders): string[] {
  if (v.bay_type === "cable_alley") return ["Cable Alley — structural bay for cable routing; width/depth set by hand."];
  if (v.bay_type === "busbar_alley") return ["Busbar Alley — structural bay for the busbar run; width/depth set by hand."];
  if (v.placed.length === 0) return ["No feeders placed yet — width/depth set by hand."];

  const lines: string[] = [];
  const acbUnits = v.placed.filter((p) => p.feeder.device_type === "ACB");
  const otherClassified = v.placed.filter((p) => p.feeder.device_type && p.feeder.device_type !== "ACB" && p.feeder.device_type !== "OTHER");
  const unclassified = v.placed.filter((p) => !p.feeder.device_type || p.feeder.device_type === "OTHER");

  if (acbUnits.length > 0) {
    const p = acbUnits[0];
    if (p.feeder.rated_current != null) {
      const frame = suggestAcbFrame(p.feeder.rated_current);
      const fn = bayFunctionOf(p.feeder) ?? "outgoing";
      const spec = lookupAcbBaySpec(frame, fn);
      if (spec) {
        lines.push(`ACB ${p.feeder.rated_current}A → frame ${frame}, ${fn.replace("_", " ")} → ArTuK spec: ${spec.widthMm}×${spec.heightMm}×${spec.depthMm}mm (IP${spec.ipRating}, Form ${spec.form}).`);
        if (v.width_mm !== spec.widthMm) lines.push(`Current width ${v.width_mm ?? "—"}mm differs from the ${spec.widthMm}mm standard — likely adjusted by hand.`);
      } else {
        lines.push(`ACB ${p.feeder.rated_current}A → frame ${frame}, ${fn.replace("_", " ")} → no ArTuK bay-spec row for this combination; generic device dimensions used, 1037mm depth assumed.`);
      }
    } else {
      lines.push("ACB with no rated current set — width/depth set by hand; give it a rating in BOM Builder for a real ArTuK size.");
    }
    if (acbUnits.length > 1) lines.push(`${acbUnits.length} ACB units share this bay — unusual; each ACB normally gets its own dedicated bay.`);
  }

  if (otherClassified.length > 0) {
    const types = Array.from(new Set(otherClassified.map((p) => DEVICE_TYPE_LABELS[p.feeder.device_type!])));
    lines.push(
      `${otherClassified.length} feeder(s) (${types.join(", ")}) pack into ArTuK's standard ${OUTGOING_MCC_BAY.widthMm}×${OUTGOING_MCC_BAY.depthMm}mm outgoing module, stacked by each feeder's rated height (see How it works → Dimensions).`
    );
    if (v.width_mm !== OUTGOING_MCC_BAY.widthMm) lines.push(`Current width ${v.width_mm ?? "—"}mm differs from the ${OUTGOING_MCC_BAY.widthMm}mm standard — likely adjusted by hand.`);
  }

  if (unclassified.length > 0) {
    lines.push(`${unclassified.length} feeder(s) with no Device Type set — sized with a flat ${DEFAULT_COMPARTMENT_HEIGHT_MM}mm fallback slot; set Device Type + rating in BOM Builder for a real ArTuK height.`);
  }

  return lines;
}

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

  const { data: revision } = await supabase.from("revisions").select("project_id").eq("id", switchboard.revision_id).single();
  const { data: project } = revision
    ? await supabase.from("projects").select("busbar_density_cu, busbar_density_al").eq("id", (revision as { project_id: string }).project_id).single()
    : { data: null };
  const { data: overrideRows } = await supabase.from("busbar_overrides").select("*").eq("switchboard_id", switchboardId);

  const overrides = overridesFromRows((overrideRows ?? []) as BusbarOverrideRow[]);

  const densityRow = project as { busbar_density_cu: number; busbar_density_al: number } | null;
  return {
    switchboard: switchboard as Switchboard,
    verticals: verticalsWithFeeders,
    densities: { Cu: Number(densityRow?.busbar_density_cu ?? 1.6), Al: Number(densityRow?.busbar_density_al ?? 1.0) },
    overrides,
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
    device_type: null,
    rated_kw: null,
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
    dummy_slot: null,
    dummy_height_mm: null,
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
// Per-unit heights of a row as a full-length array (null = standard).
function unitHeightsOf(p: Pick<PlacedWithFeeder, "qty" | "unit_heights">): (number | null)[] {
  return Array.from({ length: p.qty }, (_, i) => p.unit_heights?.[i] ?? null);
}
// Stored form: null when every unit is at its standard height.
function packHeights(h: (number | null)[]): (number | null)[] | null {
  return h.some((x) => x != null) ? h : null;
}

// heights: the moved units' own heights (carried with them), else standard.
function mergeQtyInto(
  verts: VerticalWithFeeders[],
  targetVerticalId: string,
  feederId: string,
  feeder: Feeder,
  qty: number,
  heights: (number | null)[] = []
): VerticalWithFeeders[] {
  const incoming = Array.from({ length: qty }, (_, i) => heights[i] ?? null);
  return verts.map((v) => {
    if (v.id !== targetVerticalId) return v;
    const existing = v.placed.find((p) => p.feeder_id === feederId);
    if (existing)
      return {
        ...v,
        placed: v.placed.map((p) =>
          p.id === existing.id ? { ...p, qty: p.qty + qty, unit_heights: packHeights([...unitHeightsOf(p), ...incoming]) } : p
        ),
      };
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
      unit_heights: packHeights(incoming),
    };
    return { ...v, placed: [...v.placed, newRow] };
  });
}

// The inverse of mergeQtyInto for a single unit: takes exactly one unit's worth off the
// matching row in a vertical, dropping the row once it reaches zero.
// Takes unit `unitIndex` out of a row (dropping its height entry too).
function takeUnit(verts: VerticalWithFeeders[], verticalId: string, placedId: string, unitIndex: number): VerticalWithFeeders[] {
  return verts.map((v) => {
    if (v.id !== verticalId) return v;
    const row = v.placed.find((p) => p.id === placedId);
    if (!row) return v;
    if (row.qty <= 1) return { ...v, placed: v.placed.filter((p) => p.id !== placedId) };
    const h = unitHeightsOf(row);
    h.splice(Math.min(Math.max(unitIndex, 0), row.qty - 1), 1);
    return { ...v, placed: v.placed.map((p) => (p.id === placedId ? { ...p, qty: p.qty - 1, unit_heights: packHeights(h) } : p)) };
  });
}

function makeVertical(
  switchboardId: string,
  name: string,
  bayType: BayType,
  widthMm: number,
  depthMm: number | null,
  sortOrder: number
): VerticalWithFeeders {
  return {
    id: newId(),
    switchboard_id: switchboardId,
    name,
    width_mm: widthMm,
    depth_mm: depthMm,
    bay_type: bayType,
    sort_order: sortOrder,
    created_at: new Date().toISOString(),
    dummy_slot: null,
    dummy_height_mm: null,
    placed: [],
  };
}

// Plain rect-intersection collision detection needs the DRAGGED card's
// whole bounding box to overlap a droppable's box -- with bays now
// rendered at their real (often narrow) mm width instead of a fixed
// 224px card, a wide sidebar drag card can be wider than the bay itself,
// so full-rect overlap frequently never registers. Falling back through
// pointer-position collision (does the cursor sit inside the bay?) fixes
// dropping onto any bay regardless of how narrow it is.
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

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
  // side of the panel cables come in/out from (Front / Rear) -- shown with
  // cable entry/exit in the summary table, e.g. "CABLE ENTRY – REAR TOP"
  const [cableAccess, setCableAccess] = useState<Switchboard["cable_access"]>(null);
  const [savedCableAccess, setSavedCableAccess] = useState<Switchboard["cable_access"]>(null);
  const [panelHeight, setPanelHeight] = useState(2100);
  const [savedPanelHeight, setSavedPanelHeight] = useState(2100);
  const [busbarHeight, setBusbarHeight] = useState(BUSBAR_CHAMBER_HEIGHT_MM);
  const [savedBusbarHeight, setSavedBusbarHeight] = useState(BUSBAR_CHAMBER_HEIGHT_MM);
  const [busbarOverrides, setBusbarOverrides] = useState<Record<string, BusbarOverride>>({});
  const [savedBusbarOverrides, setSavedBusbarOverrides] = useState<Record<string, BusbarOverride>>({});
  const [densities, setDensities] = useState<{ Cu: number; Al: number }>({ Cu: 1.6, Al: 1.0 });
  const [showBusbars, setShowBusbars] = useState(true);
  const [selectedSegmentKey, setSelectedSegmentKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const [search, setSearch] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [draggingFeeder, setDraggingFeeder] = useState<Feeder | null>(null);
  const [hover, setHover] = useState<HoverExtent>(null);
  const [selectedBayId, setSelectedBayId] = useState<string | null>(null);
  const [selectedPlacedId, setSelectedPlacedId] = useState<string | null>(null);
  // which unit of a multi-qty row is selected (a row of 4 MCCBs is 4 units)
  const [selectedUnitIndex, setSelectedUnitIndex] = useState(0);
  const [busbarSelected, setBusbarSelected] = useState(false);
  // bay shown in the side view: the bay last clicked in the front view.
  // Selecting one of its busbars keeps it; deselecting the bay (Esc, click
  // off) clears it -- and with no bay, the side view shows no busbars.
  const [sideBayId, setSideBayId] = useState<string | null>(null);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [sizingLogicOpen, setSizingLogicOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === fullscreenRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      fullscreenRef.current?.requestFullscreen();
    }
  }

  // Rasterizes the front+side view drawing (drawingRef) client-side --
  // html2canvas-pro/jsPDF are dynamically imported so they never load into
  // the SSR bundle, only when the user actually exports. Using the "-pro"
  // fork specifically: Tailwind v4's `/NN` opacity utilities (border-black/70,
  // bg-surface-container-low/50, etc., used all over this drawing) compile to
  // CSS `color-mix()`, which the original html2canvas's color parser doesn't
  // understand and throws on -- html2canvas-pro adds that support.
  async function captureDrawing() {
    if (!drawingRef.current) return null;
    const { default: html2canvas } = await import("html2canvas-pro");
    return html2canvas(drawingRef.current, { backgroundColor: "#ffffff", scale: 2 });
  }

  function downloadFileName(ext: string) {
    return `${(sb?.tag || "switchboard").replace(/[^a-z0-9-]+/gi, "-")}-GA.${ext}`;
  }

  async function exportPng() {
    if (exporting) return;
    setExporting(true);
    try {
      const canvas = await captureDrawing();
      if (!canvas) return;
      const link = document.createElement("a");
      link.download = downloadFileName("png");
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      alert(`Could not export the GA drawing as PNG.${e instanceof Error ? ` (${e.message})` : ""}`);
    } finally {
      setExporting(false);
    }
  }

  async function exportPdf() {
    if (exporting) return;
    setExporting(true);
    try {
      const [canvas, { jsPDF }] = await Promise.all([captureDrawing(), import("jspdf")]);
      if (!canvas) return;
      const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
      const pdf = new jsPDF({ orientation, unit: "pt", format: [canvas.width, canvas.height] });
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(downloadFileName("pdf"));
    } catch (e) {
      alert(`Could not export the GA drawing as PDF.${e instanceof Error ? ` (${e.message})` : ""}`);
    } finally {
      setExporting(false);
    }
  }

  async function refreshGaData() {
    const data = await loadGaData(supabase, switchboardId);
    if (!data) return;
    setSb(data.switchboard);
    setVerticals(data.verticals);
    setSavedVerticals(data.verticals);
    const plinth = data.switchboard.plinth_height_mm ?? 100;
    const panel = data.switchboard.panel_height_mm ?? 2100;
    const busbar = data.switchboard.busbar_chamber_height_mm ?? BUSBAR_CHAMBER_HEIGHT_MM;
    setPlinthHeight(plinth);
    setSavedPlinthHeight(plinth);
    setCableAccess(data.switchboard.cable_access ?? null);
    setSavedCableAccess(data.switchboard.cable_access ?? null);
    setPanelHeight(panel);
    setSavedPanelHeight(panel);
    setBusbarHeight(busbar);
    setSavedBusbarHeight(busbar);
    setDensities(data.densities);
    setBusbarOverrides(data.overrides);
    setSavedBusbarOverrides(data.overrides);
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
      const busbar = data.switchboard.busbar_chamber_height_mm ?? BUSBAR_CHAMBER_HEIGHT_MM;
      setPlinthHeight(plinth);
      setSavedPlinthHeight(plinth);
      setCableAccess(data.switchboard.cable_access ?? null);
      setSavedCableAccess(data.switchboard.cable_access ?? null);
      setPanelHeight(panel);
      setSavedPanelHeight(panel);
      setBusbarHeight(busbar);
      setSavedBusbarHeight(busbar);
      setDensities(data.densities);
      setBusbarOverrides(data.overrides);
      setSavedBusbarOverrides(data.overrides);
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
    cableAccess !== savedCableAccess ||
    panelHeight !== savedPanelHeight ||
    busbarHeight !== savedBusbarHeight ||
    JSON.stringify(busbarOverrides) !== JSON.stringify(savedBusbarOverrides);

  const bays = verticals.filter((v) => v.bay_type !== "unassigned").sort((a, b) => a.sort_order - b.sort_order);
  const unallocated = verticals.find((v) => v.bay_type === "unassigned") ?? null;
  const totalWidth = bays.reduce((s, v) => s + (v.width_mm ?? 0), 0);

  // Left-edge cumulative offset (mm) of each bay, for the horizontal ruler
  // and the hover-highlight band.
  const bayOffsets: number[] = [];
  {
    let cum = 0;
    for (const v of bays) {
      bayOffsets.push(cum);
      cum += v.width_mm ?? 0;
    }
  }

  const totalHeightMm = busbarHeight + panelHeight + plinthHeight;
  // The ArTuK bay's own height (what the vertical dimension arrow shows) runs
  // from just above the plinth to just below the red strip -- busbar chamber
  // + panel, excluding the plinth (a separate structural base, not part of
  // the bay housing itself).
  const bayHeightMm = busbarHeight + panelHeight;
  // Vertical numbers as on a GA drawing: switchgear bays are 1F, 2F, 3F...
  // left to right; cable/busbar alleys aren't numbered.
  const bayNumbers = new Map<string, number>();
  for (const v of bays) {
    if (v.bay_type === "cable_alley" || v.bay_type === "busbar_alley") continue;
    bayNumbers.set(v.id, bayNumbers.size + 1);
  }
  const pxPerMm = computePxPerMm(totalHeightMm);
  const selectedBay = bays.find((v) => v.id === selectedBayId) ?? null;

  // Side view: the whole switchboard uses the deepest bay's depth (so the
  // drawing never understates how far the enclosure projects); a single
  // bay chosen for the side view uses its own depth.
  const sideBay = bays.find((v) => v.id === sideBayId) ?? null;
  const deepestBayMm = Math.max(0, ...bays.map((v) => v.depth_mm ?? 0)) || DEFAULT_BAY_DEPTH_MM;
  const sideViewDepthMm = sideBay ? (sideBay.depth_mm ?? deepestBayMm) : deepestBayMm;
  const sideViewWidthPx = Math.max(sideViewDepthMm * pxPerMm, 1);

  // Physically, the busbar chamber sits away from wherever cables enter the
  // panel (more room to route cable near the entry side); the base plinth
  // is always the floor support, so it stays at the very bottom regardless.
  const busbarPosition = chamberPositionFor(sb?.cable_entry ?? null);

  // Live busbar routing/sizing for the current draft layout -- recomputed on
  // every render so it always follows the bays/feeders as they're edited;
  // only the user's deliberate overrides are stored.
  const busbarMaterial: "Cu" | "Al" = sb?.busbar ?? "Cu";
  const busbarPlan: BusbarPlan | null = sb
    ? planForSwitchboard({
        params: sb,
        verticals: bays,
        overrides: busbarOverrides,
        densities,
        panelHeightMm: panelHeight,
        chamberHeightMm: busbarHeight,
      })
    : null;
  const selectedSegment = busbarPlan?.segments.find((seg) => seg.key === selectedSegmentKey) ?? null;

  function patchSegmentOverrides(
    segs: BusbarSegment[],
    patch: Partial<Pick<BusbarOverride, "barWidthMm" | "barThicknessMm" | "runsPerPhase" | "lengthMm" | "startExtMm" | "endExtMm">>
  ) {
    setBusbarOverrides((prev) => {
      const next = { ...prev };
      for (const seg of segs) {
        const base: BusbarOverride = prev[seg.key] ?? {
          kind: seg.kind,
          verticalId: seg.verticalId,
          placedFeederId: seg.placedFeederId,
          unitIndex: seg.unitIndex,
          barWidthMm: null,
          barThicknessMm: null,
          runsPerPhase: null,
          lengthMm: null,
        };
        const merged = { ...base, ...patch };
        if (
          merged.barWidthMm == null &&
          merged.barThicknessMm == null &&
          merged.runsPerPhase == null &&
          merged.lengthMm == null &&
          !merged.startExtMm &&
          !merged.endExtMm
        )
          delete next[seg.key];
        else next[seg.key] = merged;
      }
      return next;
    });
  }

  // A dragged bar end: add the drag to that end's stored extension (a
  // typed length gives way to the drag).
  function stretchSegment(key: string, end: "start" | "end", deltaMm: number) {
    const seg = busbarPlan?.segments.find((x) => x.key === key);
    if (!seg) return;
    const o = busbarOverrides[key];
    const field = end === "start" ? "startExtMm" : "endExtMm";
    const other = (end === "start" ? o?.endExtMm : o?.startExtMm) ?? 0;
    // new length = what's shown now + the drag; stored as this end's
    // extension over the auto length (so a typed length carries over)
    const ext = Math.round(seg.lengthMm + deltaMm - seg.autoLengthMm - other);
    patchSegmentOverrides([seg], { [field]: ext || null, lengthMm: null });
    setResetKey((k) => k + 1);
  }

  function resetSegmentOverrides(keys: string[]) {
    setBusbarOverrides((prev) => {
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  }

  function selectSegment(key: string | null) {
    setSelectedSegmentKey(key);
    if (key) {
      setSelectedBayId(null);
      setSelectedPlacedId(null);
      setBusbarSelected(false);
    }
  }

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
      dummy_slot: null,
      dummy_height_mm: null,
      placed: [],
    };
    created.sort_order = nextBaySortOrder();
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
      next = mergeQtyInto(next, unassigned.id, p.feeder_id, p.feeder, p.qty, unitHeightsOf(p));
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

  // Manual alternates to what Auto-generate GA picks by default (see
  // artuk-sizing.ts's default policy) -- empty bays the user drags
  // feeders into by hand, same as any other bay template.
  function addMccFrontAccessPair() {
    if (!sb || readOnly) return;
    const primary = makeVertical(sb.id, "MCC Front Access", "outgoing", MCC_FRONT_ACCESS_PAIR.primary.widthMm, MCC_FRONT_ACCESS_PAIR.primary.depthMm, nextBaySortOrder());
    const paired = makeVertical(sb.id, "MCC Front Access", "outgoing", MCC_FRONT_ACCESS_PAIR.paired.widthMm, MCC_FRONT_ACCESS_PAIR.paired.depthMm, nextBaySortOrder() + 1);
    setVerticals([...verticals, primary, paired]);
  }

  function add2TierOutgoingE12() {
    if (!sb || readOnly) return;
    const primary = makeVertical(sb.id, "Outgoing (E1.2 2-Tier)", "outgoing", ACB_2TIER_OUTGOING_E12.primary.widthMm, ACB_2TIER_OUTGOING_E12.primary.depthMm, nextBaySortOrder());
    const paired = makeVertical(sb.id, "Outgoing (E1.2 2-Tier)", "outgoing", ACB_2TIER_OUTGOING_E12.paired.widthMm, ACB_2TIER_OUTGOING_E12.paired.depthMm, nextBaySortOrder() + 1);
    setVerticals([...verticals, primary, paired]);
  }

  // Sizes every existing bay from the feeders the user has already placed
  // into it by hand (drag-and-drop, or the +Incomer/+Outgoing/etc
  // templates) -- it never creates, deletes, or moves a bay, and never
  // moves a feeder between bays. A bay holding an ACB gets its width/depth
  // from ArTuK's bay-spec table for that ACB's frame + function (falling
  // back to the device's generic dimensions when no row covers that exact
  // combination); a bay holding any other classified device gets ArTuK's
  // standard outgoing module size. Alley bays, empty bays, and bays whose
  // feeders have no Device Type set are left untouched.
  function autoGenerateGa() {
    if (!sb || readOnly) return;
    setVerticals(
      verticals.map((v) => {
        const size = artukBaySize(v);
        return size ? { ...v, width_mm: size.widthMm, depth_mm: size.depthMm } : v;
      })
    );
  }

  // sort_order for a bay added at the right-hand end (gaps left by deleted
  // bays mean bays.length isn't always past the last one)
  function nextBaySortOrder() {
    return Math.max(-1, ...bays.map((b) => b.sort_order)) + 1;
  }

  // Swaps the bay with its left/right neighbour -- how the left/right arrow
  // overlay (and ArrowLeft/ArrowRight keys) reposition a selected bay. Every
  // bay is renumbered 0..n-1 in the new order rather than just swapping the
  // two sort_orders: after bays are deleted/added, two can share a
  // sort_order, and swapping equal values would never move anything.
  function moveBay(bayId: string, direction: "left" | "right") {
    const idx = bays.findIndex((v) => v.id === bayId);
    const swapIdx = direction === "left" ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= bays.length) return;
    const order = bays.map((v) => v.id);
    [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
    const position = new Map(order.map((id, i) => [id, i]));
    setVerticals(verticals.map((v) => (position.has(v.id) ? { ...v, sort_order: position.get(v.id)! } : v)));
  }

  // Swaps tier_number (and sort_order) with the feeder stacked above/below
  // it in the same bay -- how the up/down arrow overlay (and ArrowUp/
  // ArrowDown keys) reorder a selected feeder within its bay. The blank/
  // DUMMY gap moves independently, at UNIT granularity (dummy_slot is a
  // flat count of individual units, not rows) -- so it can land between
  // two units of the very same multi-qty row (four merged MCCBs, say), not
  // only between two different rows. A row is still one row: moving it
  // still swaps its tier_number/sort_order with one adjacent row, but if
  // the dummy is nested inside the moved row or the row it swaps with, the
  // dummy's own unit index shifts along with whichever half of that pair
  // it's nested in, so it stays visually in the same place relative to the
  // units around it instead of jumping.
  function moveFeeder(bayId: string, placedId: string, unitIndex: number, direction: "up" | "down") {
    const bay = verticals.find((v) => v.id === bayId);
    if (!bay) return;
    const dummyId = `${bayId}::dummy`;

    // The bay as drawn, one entry per physical unit (plus the blank space
    // when it shows). Moving swaps ONE unit with its neighbour -- so one of
    // four merged MCCBs can leave the group -- then the rows are rebuilt:
    // runs of identical adjacent units merge back into one row, a split row
    // keeps its id on its first run and the rest get new rows.
    const seq = computeCompartments(bay, panelHeight).map((c) => ({ isBlank: c.isBlank, placedId: c.placedId!, unitIndex: c.unitIndex ?? 0 }));
    const pos = seq.findIndex((e) => (placedId === dummyId ? e.isBlank : !e.isBlank && e.placedId === placedId && e.unitIndex === unitIndex));
    const target = direction === "up" ? pos - 1 : pos + 1;
    if (pos === -1 || target < 0 || target >= seq.length) return;
    [seq[pos], seq[target]] = [seq[target], seq[pos]];

    const rowsById = new Map(bay.placed.map((p) => [p.id, p]));
    const groups: { row: PlacedWithFeeder; units: { placedId: string; unitIndex: number }[] }[] = [];
    const heightOfUnit = (u: { placedId: string; unitIndex: number }) => rowsById.get(u.placedId)?.unit_heights?.[u.unitIndex] ?? null;
    let dummySlot = bay.dummy_slot;
    let unitsSoFar = 0;
    for (const e of seq) {
      if (e.isBlank) {
        dummySlot = unitsSoFar;
        continue;
      }
      const row = rowsById.get(e.placedId)!;
      const last = groups[groups.length - 1];
      if (last && last.row.feeder_id === row.feeder_id && last.row.label_override === row.label_override) last.units.push(e);
      else groups.push({ row, units: [e] });
      unitsSoFar++;
    }

    const usedIds = new Set<string>();
    let selection = { placedId, unitIndex };
    const rebuilt = groups.map((g, i) => {
      const preferred = g.units.map((u) => u.placedId).find((id) => !usedIds.has(id));
      const id = preferred ?? newId();
      usedIds.add(id);
      g.units.forEach((u, k) => {
        if (u.placedId === placedId && u.unitIndex === unitIndex) selection = { placedId: id, unitIndex: k };
      });
      return { ...g.row, id, qty: g.units.length, tier_number: i + 1, sort_order: i, unit_heights: packHeights(g.units.map(heightOfUnit)) };
    });

    setVerticals(verticals.map((v) => (v.id === bayId ? { ...v, placed: rebuilt, dummy_slot: dummySlot } : v)));
    if (placedId !== dummyId) {
      setSelectedPlacedId(selection.placedId);
      setSelectedUnitIndex(selection.unitIndex);
    }
  }

  // A unit dropped from the available-feeders list moves exactly one unit
  // of that placement into the target bay. If the target bay already holds
  // a placement of the same feeder, it merges into it (qty+1) instead of
  // creating a second row for the same feeder in the same bay.
  // The dragged unit keeps its own height (one set earlier, before it was
  // sent back to the list).
  function allocateUnit(placedId: string, unitIndex: number, toVerticalId: string) {
    if (!unallocated) return;
    const placedRow = unallocated.placed.find((p) => p.id === placedId);
    if (!placedRow) return;
    const height = unitHeightsOf(placedRow)[unitIndex] ?? null;
    const afterRemove = takeUnit(verticals, unallocated.id, placedId, unitIndex);
    setVerticals(mergeQtyInto(afterRemove, toVerticalId, placedRow.feeder_id, placedRow.feeder, 1, [height]));
  }

  // "Removing" a feeder from a bay sends its whole placement (however many
  // units it holds) back to the available-feeders list instead of deleting
  // it -- feeders (other than spares) belong to the BOM, so GA only ever
  // re-files their placement, never their existence. It merges into
  // whatever's already unassigned for that feeder rather than creating a
  // duplicate row there.
  // Sends ONE unit of a placed row back to the available-feeders list (a row
  // of 4 merged MCCBs keeps the other 3). The unit carries its own height,
  // so it comes back at that height when placed again.
  function removeUnitFromBay(verticalId: string, placedId: string, unitIndex: number) {
    if (!sb) return;
    const vertical = verticals.find((v) => v.id === verticalId);
    const placedRow = vertical?.placed.find((p) => p.id === placedId);
    if (!placedRow) return;
    const height = unitHeightsOf(placedRow)[unitIndex] ?? null;
    const { unassigned, verts } = withUnassigned(verticals, sb.id);
    const shrunk = takeUnit(verts, verticalId, placedId, unitIndex);
    setVerticals(mergeQtyInto(shrunk, unassigned.id, placedRow.feeder_id, placedRow.feeder, 1, [height]));
    setSelectedPlacedId(null);
  }

  // Drag-and-drop between bays: one unit leaves its row (the rest stay) and
  // joins the target bay at the bottom, merging with a row of the same
  // feeder there; its height goes with it. It stays selected in its new bay.
  function moveUnitToBay(fromVerticalId: string, placedId: string, unitIndex: number, toVerticalId: string) {
    const row = verticals.find((v) => v.id === fromVerticalId)?.placed.find((p) => p.id === placedId);
    if (!row) return;
    const height = unitHeightsOf(row)[unitIndex] ?? null;
    const next = mergeQtyInto(takeUnit(verticals, fromVerticalId, placedId, unitIndex), toVerticalId, row.feeder_id, row.feeder, 1, [height]);
    setVerticals(next);
    const target = next.find((v) => v.id === toVerticalId)?.placed.find((p) => p.feeder_id === row.feeder_id);
    if (target) {
      setSelectedBayId(toVerticalId);
      setSideBayId(toVerticalId);
      setSelectedPlacedId(target.id);
      setSelectedUnitIndex(target.qty - 1);
    }
  }

  // Height of one unit only -- other units of the same feeder keep theirs.
  function setUnitHeight(verticalId: string, placedId: string, unitIndex: number, heightMm: number | null) {
    setVerticals(
      verticals.map((v) =>
        v.id !== verticalId
          ? v
          : {
              ...v,
              placed: v.placed.map((p) => {
                if (p.id !== placedId) return p;
                const h = unitHeightsOf(p);
                h[unitIndex] = heightMm;
                return { ...p, unit_heights: packHeights(h) };
              }),
            }
      )
    );
  }

  function setDummyHeight(verticalId: string, heightMm: number | null) {
    setVerticals(verticals.map((v) => (v.id === verticalId ? { ...v, dummy_height_mm: heightMm } : v)));
  }

  function handleCancel() {
    setVerticals(structuredClone(savedVerticals));
    setPlinthHeight(savedPlinthHeight);
    setCableAccess(savedCableAccess);
    setPanelHeight(savedPanelHeight);
    setBusbarHeight(savedBusbarHeight);
    setBusbarOverrides(savedBusbarOverrides);
    setBusbarSelected(false);
    setSelectedSegmentKey(null);
    setResetKey((k) => k + 1);
  }

  async function handleSave() {
    if (!sb || readOnly) return;
    setSaving(true);
    try {
      const tempVerticalIdMap = new Map<string, string>();
      const tempFeederIdMap = new Map<string, string>();
      const tempPlacedIdMap = new Map<string, string>();

      for (const v of verticals) {
        if (!v.id.startsWith("new-")) continue;
        const { data, error } = await supabase
          .from("verticals")
          .insert({
            switchboard_id: sb.id,
            name: v.name,
            bay_type: v.bay_type,
            width_mm: v.width_mm,
            depth_mm: v.depth_mm,
            sort_order: v.sort_order,
            dummy_slot: v.dummy_slot,
            dummy_height_mm: v.dummy_height_mm,
          })
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
        if (v.dummy_slot !== prev.dummy_slot) fieldPatch.dummy_slot = v.dummy_slot;
        if (v.dummy_height_mm !== prev.dummy_height_mm) fieldPatch.dummy_height_mm = v.dummy_height_mm;
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
            const { data, error } = await supabase
              .from("placed_feeders")
              .insert({
                vertical_id: realVerticalId,
                feeder_id: realFeederId,
                qty: p.qty,
                sort_order: p.sort_order,
                tier_number: p.tier_number,
                unit_heights: p.unit_heights ?? null,
              })
              .select("id")
              .single();
            if (error || !data) throw new Error(error?.message ?? "Could not place feeder.");
            tempPlacedIdMap.set(p.id, (data as { id: string }).id);
            continue;
          }
          keptPlacedIds.add(p.id);
          const prevVertical = savedVerticals.find((sv) => sv.placed.some((sp) => sp.id === p.id));
          const prev = prevVertical?.placed.find((sp) => sp.id === p.id);
          const fieldPatch: Partial<PlacedFeeder> = {};
          if (!prevVertical || prevVertical.id !== v.id) fieldPatch.vertical_id = realVerticalId;
          if (!prev || prev.sort_order !== p.sort_order) fieldPatch.sort_order = p.sort_order;
          if (!prev || prev.tier_number !== p.tier_number) fieldPatch.tier_number = p.tier_number;
          if (JSON.stringify(prev?.unit_heights ?? null) !== JSON.stringify(p.unit_heights ?? null)) fieldPatch.unit_heights = p.unit_heights ?? null;
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

      // Busbar overrides are rewritten wholesale when they've changed --
      // there are only ever a handful per switchboard. Any pointing at a
      // bay/feeder removed in this draft are dropped (the DB would cascade
      // them away anyway); temp ids from this draft are mapped to real ones.
      if (JSON.stringify(busbarOverrides) !== JSON.stringify(savedBusbarOverrides)) {
        const liveVerticalIds = new Set(verticals.map((v) => v.id));
        const livePlacedIds = new Set(verticals.flatMap((v) => v.placed.map((p) => p.id)));
        const rows = Object.values(busbarOverrides)
          .filter((o) => (!o.verticalId || liveVerticalIds.has(o.verticalId)) && (!o.placedFeederId || livePlacedIds.has(o.placedFeederId)))
          .map((o) => ({
            switchboard_id: sb.id,
            kind: o.kind,
            vertical_id: o.verticalId ? (tempVerticalIdMap.get(o.verticalId) ?? o.verticalId) : null,
            placed_feeder_id: o.placedFeederId ? (tempPlacedIdMap.get(o.placedFeederId) ?? o.placedFeederId) : null,
            unit_index: o.unitIndex,
            bar_width_mm: o.barWidthMm,
            bar_thickness_mm: o.barThicknessMm,
            runs_per_phase: o.runsPerPhase,
            length_mm: o.lengthMm,
            start_ext_mm: o.startExtMm || null,
            end_ext_mm: o.endExtMm || null,
            updated_at: new Date().toISOString(),
          }));
        const { error: delError } = await supabase.from("busbar_overrides").delete().eq("switchboard_id", sb.id);
        if (delError) throw new Error(delError.message);
        if (rows.length > 0) {
          const { error } = await supabase.from("busbar_overrides").insert(rows);
          if (error) throw new Error(error.message);
        }
      }

      const paramPatch: Partial<Switchboard> = {};
      if (plinthHeight !== savedPlinthHeight) paramPatch.plinth_height_mm = plinthHeight;
      if (cableAccess !== savedCableAccess) paramPatch.cable_access = cableAccess;
      if (panelHeight !== savedPanelHeight) paramPatch.panel_height_mm = panelHeight;
      if (busbarHeight !== savedBusbarHeight) paramPatch.busbar_chamber_height_mm = busbarHeight;
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

  // Arrow keys reposition whatever's selected: Left/Right moves the
  // selected bay, Up/Down moves the selected feeder within its bay (same
  // action as the overlay arrow buttons on the drawing). Ignored while
  // typing in a text field, and while read-only.
  const keyboardMoveRef = useRef({ readOnly, selectedBayId, selectedPlacedId, selectedUnitIndex, moveBay, moveFeeder, removeUnitFromBay });
  useEffect(() => {
    keyboardMoveRef.current = { readOnly, selectedBayId, selectedPlacedId, selectedUnitIndex, moveBay, moveFeeder, removeUnitFromBay };
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.key.startsWith("Arrow") && e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const { readOnly, selectedBayId, selectedPlacedId, selectedUnitIndex, moveBay, moveFeeder, removeUnitFromBay } = keyboardMoveRef.current;
      if (readOnly || !selectedBayId) return;
      // Delete / Backspace: send the selected feeder unit back to the available list
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedPlacedId && !selectedPlacedId.endsWith("::dummy")) {
          e.preventDefault();
          removeUnitFromBay(selectedBayId, selectedPlacedId, selectedUnitIndex);
        }
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        moveBay(selectedBayId, e.key === "ArrowLeft" ? "left" : "right");
      } else if (selectedPlacedId && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        moveFeeder(selectedBayId, selectedPlacedId, selectedUnitIndex, e.key === "ArrowUp" ? "up" : "down");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // "F" toggles fullscreen and Escape deselects everything (both ignored
  // while typing in a field).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "Escape") {
        // Escape clears every selection on the canvas (bay, feeder, busbar,
        // busbar chamber) -- and leaves fullscreen if it's on.
        setSelectedBayId(null);
        setSideBayId(null);
        setSelectedPlacedId(null);
        setSelectedSegmentKey(null);
        setBusbarSelected(false);
        if (document.fullscreenElement) document.exitFullscreen();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("placed-")) {
      const [verticalId, placedId] = id.replace("placed-", "").split("::");
      const placed = verticals.find((v) => v.id === verticalId)?.placed.find((p) => p.id === placedId);
      if (placed) setDraggingFeeder(placed.feeder);
      return;
    }
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

    // a feeder unit dragged out of a bay: onto another bay moves just that
    // unit there (keeping its own height); onto the available-feeders list
    // sends it back
    if (activeId.startsWith("placed-")) {
      const [fromVerticalId, placedId, unit] = activeId.replace("placed-", "").split("::");
      const unitIndex = Number(unit) || 0;
      if (overId === "available-feeders") {
        removeUnitFromBay(fromVerticalId, placedId, unitIndex);
        return;
      }
      if (!overId.startsWith("bay-")) return;
      const toVerticalId = overId.replace("bay-", "");
      if (toVerticalId !== fromVerticalId) moveUnitToBay(fromVerticalId, placedId, unitIndex, toVerticalId);
      return;
    }

    if (!overId.startsWith("bay-")) return;
    const verticalId = overId.replace("bay-", "");

    if (activeId.startsWith("unit-") && unallocated) {
      const [placedId, unit] = activeId.replace("unit-", "").split("::");
      allocateUnit(placedId, Number(unit) || 0, verticalId);
    }
  }

  if (loading || !sb) {
    return <div className="p-8 text-sm text-on-surface-variant">Loading...</div>;
  }

  // Same px heights the drawing actually renders (DrawingBar enforces a
  // 16px minimum), so the busbar overlay lines up with the chamber/bays.
  const chamberPx = Math.max(busbarHeight * pxPerMm, 16);
  const panelPx = Math.max(panelHeight * pxPerMm, 2);
  const busbarYPx = (mm: number) => {
    if (busbarPosition === "top") return mm <= busbarHeight ? (mm / busbarHeight) * chamberPx : chamberPx + (mm - busbarHeight) * pxPerMm;
    return mm <= panelHeight ? mm * pxPerMm : panelPx + ((mm - panelHeight) / busbarHeight) * chamberPx;
  };

  const busbarLabel = `BUSBAR CHAMBER${sb.amps ? ` · ${sb.amps}A` : ""}${sb.ka ? ` · ${sb.ka}kA` : ""} · ${sb.busbar ?? "Cu"}`;
  // With the busbar layer on, the main bar's own label (size + rating)
  // replaces the chamber caption, which it would otherwise strike through.
  const chamberCaption = showBusbars && busbarPlan && bays.length > 0 ? "" : busbarLabel;

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-full flex-col">
        <SavingOverlay show={saving} />

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
          <Field label="Cable Access">
            <select
              disabled={readOnly}
              value={cableAccess ?? ""}
              onChange={(e) => setCableAccess((e.target.value || null) as Switchboard["cable_access"])}
              className="rounded border border-surface-container-high px-1.5 py-1"
            >
              <option value="">—</option>
              <option value="Front">Front</option>
              <option value="Rear">Rear</option>
            </select>
          </Field>
          <ReadOnlyField label="Cable Entry" value={sb.cable_entry} />
          <ReadOnlyField label="Cable Exit" value={sb.cable_exit} />
        </div>

        <div ref={fullscreenRef} className="flex flex-1 gap-4 overflow-hidden bg-surface p-4">
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
                <AvailableDropZone disabled={readOnly}>
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
                </AvailableDropZone>
              </>
            )}
          </aside>

          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="mb-2 flex justify-end">
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen canvas"}
                className="flex items-center gap-1 rounded-md border border-surface-container-high bg-surface-container-lowest px-2 py-1.5 text-on-surface-variant shadow-sm hover:bg-surface-container-low hover:text-on-surface"
              >
                <Icon name={isFullscreen ? "fullscreen_exit" : "fullscreen"} size={16} />
              </button>
            </div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {!readOnly && sb?.std === "ArTuK" && (
                <button onClick={autoGenerateGa} className="btn btn-primary btn-sm">
                  <Icon name="auto_awesome" size={14} /> Update GA
                </button>
              )}
              <button
                onClick={exportPng}
                disabled={exporting || bays.length === 0}
                title="Export the GA drawing as a PNG image"
                className="btn btn-outline btn-sm"
              >
                <Icon name="download" size={14} /> {exporting ? "Exporting..." : "Export PNG"}
              </button>
              <button
                onClick={exportPdf}
                disabled={exporting || bays.length === 0}
                title="Export the GA drawing as a PDF"
                className="btn btn-outline btn-sm"
              >
                <Icon name="download" size={14} /> {exporting ? "Exporting..." : "Export PDF"}
              </button>
              <button
                onClick={() => {
                  setShowBusbars((v) => !v);
                  setSelectedSegmentKey(null);
                }}
                disabled={bays.length === 0}
                title={showBusbars ? "Hide the busbar layer" : "Show the planned busbar routing and sizes"}
                className={`btn btn-sm ${showBusbars ? "btn-primary" : "btn-outline"}`}
              >
                <Icon name="electric_bolt" size={14} /> Busbars
              </button>
              {!readOnly && dirty && (
                <>
                  <button onClick={handleCancel} disabled={saving} className="btn btn-outline btn-sm">
                    Cancel
                  </button>
                  <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm">
                    <Icon name="save" size={14} />
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <span className="font-body-sm text-body-sm text-amber-600">Unsaved changes</span>
                </>
              )}
            </div>
            {!readOnly && sb?.std === "ArTuK" && (
              <p className="mb-3 text-[11px] text-on-surface-variant">
                Create your bays and drag feeders into them first (each feeder needs a Device Type and rating in BOM Builder), then click
                Update GA to size every bay from what you&rsquo;ve placed, using ArTuK standard sizing -- see{" "}
                <a href="/how-it-works#dimensions" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">
                  How it works → Dimensions
                </a>{" "}
                for how sizes are worked out. It never creates, deletes, or moves bays or feeders.
              </p>
            )}
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
                {sb?.std === "ArTuK" && (
                  <>
                    <button
                      onClick={add2TierOutgoingE12}
                      title="ArTu-K 920+720w Emax 2 E1.2 2-Tier ACB Outgoing"
                      className="rounded-md border border-dashed border-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant hover:border-primary/40 hover:text-primary"
                    >
                      + 2-Tier ACB Outgoing (E1.2)
                    </button>
                    <button
                      onClick={addMccFrontAccessPair}
                      title={MCC_FRONT_ACCESS_PAIR.note}
                      className="rounded-md border border-dashed border-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant hover:border-primary/40 hover:text-primary"
                    >
                      + MCC Vertical Pair (Front Access)
                    </button>
                  </>
                )}
              </div>
            )}

            <div
              className="flex-1 overflow-auto rounded-xl border border-surface-container-high bg-surface-container-low/40 p-4"
              onClick={(e) => {
                // a click on empty canvas (not on a bay, feeder, busbar, the
                // busbar chamber or the busbar schedule) clears the selection
                if ((e.target as Element).closest("[data-ga-selectable]")) return;
                setSelectedBayId(null);
                setSideBayId(null);
                setSelectedPlacedId(null);
                setSelectedSegmentKey(null);
                setBusbarSelected(false);
              }}
            >
              {bays.length === 0 ? (
                <p className="w-full py-10 text-center text-sm text-on-surface-variant">
                  No bays yet — add one from the Modular Bay Templates above.
                </p>
              ) : (
                <div ref={drawingRef} className="flex items-start gap-10">
                  <div className="inline-block" data-ga-selectable="">
                    <div className="flex">
                      <div style={{ width: RULER_WIDTH_PX + VERTICAL_DIM_WIDTH_PX }} />
                      <div style={{ width: Math.max(totalWidth * pxPerMm, 1) }}>
                        <ViewLabel>Front View</ViewLabel>
                      </div>
                    </div>

                    {sb.std === "ArTuK" && (
                      <div className="flex">
                        <div style={{ width: RULER_WIDTH_PX + VERTICAL_DIM_WIDTH_PX }} />
                        <div
                          className="flex items-center justify-center bg-red-600 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-white"
                          style={{ width: totalWidth * pxPerMm }}
                        >
                          ArTuK
                        </div>
                      </div>
                    )}

                    {/* An ArTuK bay's own height runs from just above the plinth to just
                        below the red strip -- busbar chamber + panel, not the plinth (a
                        separate structural base). The vertical dimension line spans
                        exactly that, alongside just [busbar/bays/busbar], not the
                        title/ArTuK-strip rows above or the plinth row below. */}
                    <div className="flex items-start">
                      <VerticalDimension heightPx={bayHeightMm * pxPerMm} label={`${bayHeightMm}mm`} />
                      <div className="relative inline-block">
                      {busbarPosition === "top" && (
                        <div className="flex">
                          <div style={{ width: RULER_WIDTH_PX }} />
                          <DrawingBar
                            label={chamberCaption}
                            heightPx={busbarHeight * pxPerMm}
                            widthPx={totalWidth * pxPerMm}
                            isSelected={busbarSelected}
                            onClick={
                              readOnly
                                ? undefined
                                : () => {
                                    setBusbarSelected(true);
                                    setSelectedBayId(null);
                                    setSideBayId(null);
                                    setSelectedPlacedId(null);
                                    setSelectedSegmentKey(null);
                                  }
                            }
                          />
                        </div>
                      )}

                      <div className="flex">
                        <VerticalRuler totalHeightMm={panelHeight} pxPerMm={pxPerMm} hover={hover} />
                        <div className="flex transition-opacity" style={{ opacity: showBusbars && busbarPlan ? 0.55 : 1 }}>
                          {bays.map((v, i) => (
                            <BayColumn
                              key={`${v.id}-${resetKey}`}
                              vertical={v}
                              bayNumber={bayNumbers.get(v.id) ?? null}
                              readOnly={readOnly}
                              pxPerMm={pxPerMm}
                              panelHeightMm={panelHeight}
                              bayLeftMm={bayOffsets[i]}
                              isSelected={selectedBayId === v.id}
                              selectedPlacedId={selectedBayId === v.id ? selectedPlacedId : null}
                              selectedUnitIndex={selectedUnitIndex}
                              cableEntry={sb.cable_entry}
                              cableExit={sb.cable_exit}
                              onSelectBay={() => {
                                setSelectedBayId(v.id);
                                setSideBayId(v.id);
                                setSelectedPlacedId(null);
                                setBusbarSelected(false);
                                setSelectedSegmentKey(null);
                              }}
                              onSelectFeeder={(placedId, unitIndex) => {
                                setSelectedBayId(v.id);
                                setSideBayId(v.id);
                                setSelectedPlacedId(placedId);
                                setSelectedUnitIndex(unitIndex);
                                setBusbarSelected(false);
                                setSelectedSegmentKey(null);
                              }}
                              onMoveBay={(direction) => moveBay(v.id, direction)}
                              onMoveFeeder={(placedId, unitIndex, direction) => moveFeeder(v.id, placedId, unitIndex, direction)}
                              onHover={setHover}
                              onHoverEnd={() => setHover(null)}
                              onRemove={(placedId, unitIndex) => removeUnitFromBay(v.id, placedId, unitIndex)}
                            />
                          ))}
                        </div>
                      </div>

                      {busbarPosition === "bottom" && (
                        <div className="flex">
                          <div style={{ width: RULER_WIDTH_PX }} />
                          <DrawingBar
                            label={chamberCaption}
                            heightPx={busbarHeight * pxPerMm}
                            widthPx={totalWidth * pxPerMm}
                            isSelected={busbarSelected}
                            onClick={
                              readOnly
                                ? undefined
                                : () => {
                                    setBusbarSelected(true);
                                    setSelectedBayId(null);
                                    setSideBayId(null);
                                    setSelectedPlacedId(null);
                                    setSelectedSegmentKey(null);
                                  }
                            }
                          />
                        </div>
                      )}

                      {showBusbars && busbarPlan && (
                        <BusbarFrontOverlay
                          plan={busbarPlan}
                          leftPx={RULER_WIDTH_PX}
                          widthPx={totalWidth * pxPerMm}
                          heightPx={chamberPx + panelPx}
                          xPx={(mm) => mm * pxPerMm}
                          yPx={busbarYPx}
                          material={busbarMaterial}
                          selectedKey={selectedSegmentKey}
                          onSelect={selectSegment}
                          pxPerMm={pxPerMm}
                          readOnly={readOnly}
                          onStretch={stretchSegment}
                        />
                      )}

                      </div>
                    </div>

                    <div className="flex">
                      <div style={{ width: RULER_WIDTH_PX + VERTICAL_DIM_WIDTH_PX }} />
                      <DrawingBar label={`PLINTH · ${plinthHeight}mm`} heightPx={plinthHeight * pxPerMm} widthPx={totalWidth * pxPerMm} />
                    </div>

                    <div className="flex">
                      <div style={{ width: RULER_WIDTH_PX + VERTICAL_DIM_WIDTH_PX }} />
                      <HorizontalRuler bayOffsets={bayOffsets} totalWidth={totalWidth} pxPerMm={pxPerMm} hover={hover} />
                    </div>

                    {/* Vertical numbers (1F, 2F...) under each switchgear bay */}
                    <div className="flex">
                      <div style={{ width: RULER_WIDTH_PX + VERTICAL_DIM_WIDTH_PX }} />
                      <div className="flex">
                        {bays.map((v) => (
                          <div key={v.id} className="py-0.5 text-center font-display text-sm font-bold text-black" style={{ width: (v.width_mm ?? 0) * pxPerMm }}>
                            {bayNumbers.has(v.id) ? `${bayNumbers.get(v.id)}F` : ""}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Per-bay width dimensions, then one overall dimension beneath --
                        same nesting convention as a real elevation drawing. */}
                    <div className="flex">
                      <div style={{ width: RULER_WIDTH_PX + VERTICAL_DIM_WIDTH_PX }} />
                      <div className="flex">
                        {bays.map((v) => (
                          <HorizontalDimension key={v.id} widthPx={(v.width_mm ?? 0) * pxPerMm} label={`${v.width_mm ?? 0}`} />
                        ))}
                      </div>
                    </div>
                    <div className="flex">
                      <div style={{ width: RULER_WIDTH_PX + VERTICAL_DIM_WIDTH_PX }} />
                      <HorizontalDimension widthPx={totalWidth * pxPerMm} label={`${totalWidth}mm`} />
                    </div>
                  </div>

                  <div className="inline-block" data-ga-selectable="">
                    <ViewLabel>Side View{sideBay ? ` — ${sideBay.name}` : ""}</ViewLabel>
                    {sb.std === "ArTuK" && (
                      <div
                        className="flex items-center justify-center bg-red-600 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-white"
                        style={{ width: sideViewWidthPx }}
                      >
                        ArTuK
                      </div>
                    )}
                    <div className="relative">
                      {busbarPosition === "top" && <DrawingBar label={chamberCaption} heightPx={busbarHeight * pxPerMm} widthPx={sideViewWidthPx} />}
                      <div className="border border-black/70 bg-white" style={{ width: sideViewWidthPx, height: Math.max(panelHeight * pxPerMm, 2) }} />
                      {busbarPosition === "bottom" && <DrawingBar label={chamberCaption} heightPx={busbarHeight * pxPerMm} widthPx={sideViewWidthPx} />}
                      {sideBay && (
                        <BusbarSideOverlay
                          plan={busbarPlan}
                          widthPx={sideViewWidthPx}
                          heightPx={chamberPx + panelPx}
                          depthMm={sideViewDepthMm}
                          yPx={busbarYPx}
                          pxPerMm={pxPerMm}
                          chamberPx={chamberPx}
                          material={busbarMaterial}
                          hasNeutral={(sb.poles ?? 4) >= 4}
                          showBars={showBusbars}
                          bay={
                            sideBay
                              ? {
                                  id: sideBay.id,
                                  name: sideBay.name,
                                  compartments: computeCompartments(sideBay, panelHeight),
                                  panelTopMm: busbarPosition === "top" ? busbarHeight : 0,
                                }
                              : null
                          }
                          selectedKey={selectedSegmentKey}
                          onSelect={selectSegment}
                        />
                      )}
                    </div>
                    <DrawingBar label={`PLINTH · ${plinthHeight}mm`} heightPx={plinthHeight * pxPerMm} widthPx={sideViewWidthPx} />
                    <HorizontalDimension widthPx={sideViewWidthPx} label={`${sideViewDepthMm}mm`} />
                    <PanelSummaryTable
                      widthMm={totalWidth}
                      depthMm={bays.some((v) => v.depth_mm != null) ? deepestBayMm : null}
                      heightMm={plinthHeight + bayHeightMm}
                      cableAccess={cableAccess}
                      cableEntry={sb.cable_entry}
                      cableExit={sb.cable_exit}
                      form={sb.form_of_separation}
                      std={sb.std}
                    />
                  </div>
                </div>
              )}
              {showBusbars && busbarPlan && bays.length > 0 && (
                <div data-ga-selectable="">
                <BusbarSchedule
                  plan={busbarPlan}
                  material={busbarMaterial}
                  density={densities[busbarMaterial]}
                  poles={sb.poles ?? 4}
                  neutralPct={sb.neutral_size_pct ?? 100}
                  readOnly={readOnly}
                  selectedKey={selectedSegmentKey}
                  onSelect={selectSegment}
                  onApplySize={(segs, bar, runs) =>
                    patchSegmentOverrides(segs, { barWidthMm: bar.widthMm, barThicknessMm: bar.thicknessMm, runsPerPhase: runs })
                  }
                  onReset={resetSegmentOverrides}
                />
                </div>
              )}
            </div>
          </div>

          <aside
            className={`shrink-0 overflow-y-auto rounded-xl border border-surface-container-high bg-surface-container-lowest shadow-xs transition-[width] ${
              rightSidebarCollapsed ? "w-11 p-2" : "w-80 p-3"
            }`}
          >
            <button
              onClick={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
              title={rightSidebarCollapsed ? "Expand bay details" : "Collapse bay details"}
              className={`mb-2 flex items-center justify-center rounded p-1 text-secondary hover:bg-surface-container-low ${
                rightSidebarCollapsed ? "w-full" : ""
              }`}
            >
              <Icon name={rightSidebarCollapsed ? "chevron_left" : "chevron_right"} size={16} />
            </button>

            {!rightSidebarCollapsed && (
              <>
                {selectedSegment ? (
                  <BusbarSegmentPanel
                    key={`${selectedSegment.key}-${resetKey}`}
                    segment={selectedSegment}
                    material={busbarMaterial}
                    density={densities[busbarMaterial]}
                    neutralPct={sb.neutral_size_pct ?? 100}
                    hasNeutral={(sb.poles ?? 4) >= 4}
                    readOnly={readOnly}
                    onPatch={(patch) => patchSegmentOverrides([selectedSegment], patch)}
                    onReset={() => resetSegmentOverrides([selectedSegment.key])}
                    onClose={() => setSelectedSegmentKey(null)}
                  />
                ) : busbarSelected ? (
                  <BusbarDetailsPanel
                    key={`busbar-${resetKey}`}
                    height={busbarHeight}
                    readOnly={readOnly}
                    onHeightChange={setBusbarHeight}
                    onClose={() => setBusbarSelected(false)}
                  />
                ) : (
                  <>
                  {/* a clicked feeder / blank space gets its own panel; the
                      bay's own details (name, width, depth) stay below it */}
                  {selectedBay && selectedPlacedId && (
                  <PlacedItemPanel
                    key={`${selectedPlacedId}-${selectedUnitIndex}-${resetKey}`}
                    bay={selectedBay}
                    placedId={selectedPlacedId}
                    unitIndex={selectedUnitIndex}
                    panelHeightMm={panelHeight}
                    readOnly={readOnly}
                    onUnitHeight={(h) => setUnitHeight(selectedBay.id, selectedPlacedId, selectedUnitIndex, h)}
                    onDummyHeight={(h) => setDummyHeight(selectedBay.id, h)}
                    onRemove={() => removeUnitFromBay(selectedBay.id, selectedPlacedId, selectedUnitIndex)}
                    onClose={() => setSelectedPlacedId(null)}
                  />
                  )}
                  <BayDetailsPanel
                    key={selectedBay?.id ?? "none"}
                    vertical={selectedBay}
                    readOnly={readOnly}
                    onRename={(name) => selectedBay && renameBay(selectedBay.id, name)}
                    onDimChange={(field, val) => selectedBay && setBayDim(selectedBay.id, field, val)}
                    onDelete={() => {
                      if (!selectedBay) return;
                      deleteBay(selectedBay.id);
                      setSelectedBayId(null);
                      setSideBayId(null);
                      setSelectedPlacedId(null);
                    }}
                    onClose={() => {
                      setSelectedBayId(null);
                      setSideBayId(null);
                      setSelectedPlacedId(null);
                    }}
                  />
                  </>
                )}

                <div className="mt-4 border-t border-surface-container-high pt-3">
                  <button
                    onClick={() => setSizingLogicOpen((v) => !v)}
                    className="flex w-full items-center justify-between text-left font-label-sm text-label-sm uppercase tracking-wide text-secondary"
                  >
                    Sizing Logic
                    <Icon name={sizingLogicOpen ? "expand_less" : "expand_more"} size={16} />
                  </button>
                  {sizingLogicOpen && (
                    <div className="mt-2 space-y-2">
                      <p className="font-body-sm text-[11px] leading-snug text-on-surface-variant">
                        How each bay&rsquo;s width and height were worked out, based on its placed feeders. See How it works → Dimensions for the
                        underlying ArTuK data.
                      </p>
                      {bays.length === 0 && <p className="font-body-sm text-body-sm text-on-surface-variant">No bays yet.</p>}
                      {bays.map((v) => (
                        <div key={v.id} className="rounded border border-surface-container-high p-2">
                          <p className="font-body-sm text-body-sm font-semibold text-on-surface">{v.name}</p>
                          {explainBay(v).map((line, i) => (
                            <p key={i} className="mt-1 text-[11px] leading-snug text-on-surface-variant">
                              {line}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
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

// A bay compartment that can be dragged to another bay (or back onto the
// available-feeders list). A plain click still selects it: dragging only
// starts after the pointer moves a few px (PointerSensor's distance).
function DraggableCell({
  dragId,
  disabled,
  className,
  children,
  ...rest
}: { dragId: string; disabled: boolean; className: string; children: React.ReactNode } & Omit<React.HTMLAttributes<HTMLDivElement>, "className">) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId, disabled });
  return (
    <div
      ref={setNodeRef}
      {...rest}
      {...(disabled ? {} : listeners)}
      {...(disabled ? {} : attributes)}
      className={`${className} ${disabled ? "" : "cursor-grab active:cursor-grabbing"} ${isDragging ? "opacity-40" : ""}`}
    >
      {children}
    </div>
  );
}

// The available-feeders list doubles as a drop target: a unit dragged out
// of a bay and dropped here goes back to the list.
function AvailableDropZone({ disabled, children }: { disabled: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "available-feeders", disabled });
  return (
    <div ref={setNodeRef} className={`min-h-16 rounded-lg ${isOver ? "bg-primary/5 ring-2 ring-primary/40" : ""}`}>
      {children}
    </div>
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

// A plain technical-drawing style bar (busbar chamber, plinth) spanning
// the full drawing width -- line art, not a themed alert/status bar.
// The busbar chamber is the one bar that's clickable/selectable (its height
// is user-editable in the right sidebar); the plinth stays plain.
function DrawingBar({
  label,
  heightPx,
  widthPx,
  onClick,
  isSelected,
}: {
  label: string;
  heightPx: number;
  widthPx: number;
  onClick?: () => void;
  isSelected?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      data-ga-selectable={onClick ? "" : undefined}
      className={`flex shrink-0 items-center justify-center overflow-hidden border bg-white px-2 text-center font-telemetry-md text-[9px] font-semibold uppercase tracking-wide text-black ${
        isSelected ? "border-2 border-primary" : "border-black/70"
      } ${onClick ? "cursor-pointer hover:bg-amber-50" : ""}`}
      style={{ height: Math.max(heightPx, 16), width: Math.max(widthPx, 1) }}
    >
      {label}
    </div>
  );
}

// Bold, underlined view caption ("FRONT VIEW" / "SIDE VIEW"), matching
// the reference AutoCAD drawing's title style above each projection.
function ViewLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-center font-telemetry-md text-[11px] font-bold uppercase tracking-wide text-black underline">{children}</p>;
}

// Small solid CSS-triangle arrowhead for dimension lines -- plain line art
// (no icon font glyph reads as a real drafting arrowhead at 9-11px).
function ArrowHead({ dir }: { dir: "left" | "right" | "up" | "down" }) {
  const style: React.CSSProperties =
    dir === "left"
      ? { borderTop: "3px solid transparent", borderBottom: "3px solid transparent", borderRight: "5px solid black" }
      : dir === "right"
        ? { borderTop: "3px solid transparent", borderBottom: "3px solid transparent", borderLeft: "5px solid black" }
        : dir === "up"
          ? { borderLeft: "3px solid transparent", borderRight: "3px solid transparent", borderBottom: "5px solid black" }
          : { borderLeft: "3px solid transparent", borderRight: "3px solid transparent", borderTop: "5px solid black" };
  return <span className="block h-0 w-0 shrink-0" style={style} />;
}

// AutoCAD-style dimension line: extension ticks at each end, an arrowed
// line spanning between them, and the mm value centered above -- used to
// call out a bay's width, the switchboard's total width, and the side
// view's depth (the reference image's "920" dimension under FRONT VIEW).
function HorizontalDimension({ widthPx, label }: { widthPx: number; label: string }) {
  const w = Math.max(widthPx, 1);
  return (
    <div className="relative shrink-0" style={{ width: w, height: 20 }}>
      <span className="absolute left-0 top-0 h-2 w-px bg-black/70" />
      <span className="absolute right-0 top-0 h-2 w-px bg-black/70" />
      <div className="absolute left-0 top-1.5 flex items-center" style={{ width: w }}>
        <ArrowHead dir="left" />
        <span className="h-px flex-1 bg-black/70" />
        <ArrowHead dir="right" />
      </div>
      <span className="absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap bg-white px-1 font-mono text-[9px] leading-none text-black">
        {label}
      </span>
    </div>
  );
}

// Vertical counterpart of HorizontalDimension -- used for the switchboard's
// total height, run alongside the existing mm-scale VerticalRuler.
function VerticalDimension({ heightPx, label }: { heightPx: number; label: string }) {
  const h = Math.max(heightPx, 1);
  return (
    <div className="relative shrink-0" style={{ width: VERTICAL_DIM_WIDTH_PX, height: h }}>
      <span className="absolute left-1 top-0 h-px w-2 bg-black/70" />
      <span className="absolute bottom-0 left-1 h-px w-2 bg-black/70" />
      <div className="absolute left-2 top-0 flex flex-col items-center" style={{ height: h }}>
        <ArrowHead dir="up" />
        <span className="w-px flex-1 bg-black/70" />
        <ArrowHead dir="down" />
      </div>
      <span
        className="absolute left-2 top-1/2 whitespace-nowrap bg-white px-1 font-mono text-[9px] leading-none text-black"
        style={{ transform: "translate(-50%, -50%) rotate(-90deg)" }}
      >
        {label}
      </span>
    </div>
  );
}

// Left-edge mm scale for the bays' shared panel height, measured bottom-up
// (0 at the base of the bays) to match a real elevation drawing.
function VerticalRuler({ totalHeightMm, pxPerMm, hover }: { totalHeightMm: number; pxPerMm: number; hover: HoverExtent }) {
  const heightPx = totalHeightMm * pxPerMm;
  const step = niceTickStepMm(pxPerMm);
  const ticks: number[] = [];
  for (let mm = 0; mm <= totalHeightMm; mm += step) ticks.push(mm);

  return (
    <div className="relative shrink-0 border-r border-black/40" style={{ width: RULER_WIDTH_PX, height: heightPx }}>
      {hover && (
        <div
          className="absolute right-0 w-full bg-amber-300/50"
          style={{ bottom: (totalHeightMm - hover.topMm - hover.heightMm) * pxPerMm, height: Math.max(hover.heightMm * pxPerMm, 1) }}
        />
      )}
      {ticks.map((mm) => (
        <div key={mm} className="absolute right-0 flex items-center gap-1" style={{ bottom: mm * pxPerMm - 0.5 }}>
          <span className="font-mono text-[8px] leading-none text-on-surface-variant">{mm}</span>
          <span className="h-px w-2 bg-black/50" />
        </div>
      ))}
    </div>
  );
}

// Bottom mm scale across the bays' cumulative width, one tick per bay
// boundary.
function HorizontalRuler({
  bayOffsets,
  totalWidth,
  pxPerMm,
  hover,
}: {
  bayOffsets: number[];
  totalWidth: number;
  pxPerMm: number;
  hover: HoverExtent;
}) {
  const widthPx = totalWidth * pxPerMm;
  const boundaries = Array.from(new Set([...bayOffsets, totalWidth]));

  return (
    <div className="relative shrink-0 border-t border-black/40" style={{ width: Math.max(widthPx, 1), height: 24 }}>
      {hover && (
        <div
          className="absolute top-0 h-full bg-amber-300/50"
          style={{ left: hover.bayLeftMm * pxPerMm, width: Math.max(hover.bayWidthMm * pxPerMm, 1) }}
        />
      )}
      {boundaries.map((mm) => (
        <div key={mm} className="absolute top-0 flex flex-col items-center" style={{ left: mm * pxPerMm }}>
          <span className="h-2 w-px bg-black/50" />
          <span className="mt-0.5 font-mono text-[8px] leading-none text-on-surface-variant">{mm}</span>
        </div>
      ))}
    </div>
  );
}

// The bay's own outline -- to-scale, no header box above it (that used to
// throw off alignment with the ruler since it had its own minimum width
// independent of the drawing's scale). Clicking the bay selects it, and
// its name/type/width/depth become editable in the right sidebar instead.
// The drawing's summary block, as on a GA sheet: overall size (W x D x H,
// H = plinth + panel + busbar chamber), cable entry/exit with the side
// cables come from, and form of separation + standard.
function PanelSummaryTable({
  widthMm,
  depthMm,
  heightMm,
  cableAccess,
  cableEntry,
  cableExit,
  form,
  std,
}: {
  widthMm: number;
  depthMm: number | null;
  heightMm: number;
  cableAccess: Switchboard["cable_access"];
  cableEntry: Switchboard["cable_entry"];
  cableExit: Switchboard["cable_exit"];
  form: string | null;
  std: Switchboard["std"];
}) {
  const route = (dir: "Top" | "Bottom" | null) => (dir ? [cableAccess, dir].filter(Boolean).join(" ").toUpperCase() : "—");
  const formText = form ? form.replace(/^form\s*/i, "").toUpperCase() : null;
  const stdText = std === "ArTuK" ? "ARTU-K, IEC 61439" : std ? `IEC ${std}` : null;
  const cell = "border border-black/70 px-2 py-1";
  return (
    <table className="mt-4 border-collapse font-mono text-[11px] text-black" style={{ minWidth: 220 }}>
      <tbody>
        <tr>
          <td colSpan={3} className={`${cell} text-center tracking-wider`}>
            SIZE OF PANEL ( MM )
          </td>
        </tr>
        <tr>
          <td className={`${cell} text-center`}>W</td>
          <td className={`${cell} text-center`}>D</td>
          <td className={`${cell} text-center`}>H</td>
        </tr>
        <tr>
          <td className={`${cell} text-center`}>{widthMm || "—"}</td>
          <td className={`${cell} text-center`} title={depthMm == null ? "No bay depth set yet" : undefined}>
            {depthMm ?? "—"}
          </td>
          <td className={`${cell} text-center`}>{heightMm}</td>
        </tr>
        <tr>
          <td colSpan={3} className={cell}>
            CABLE ENTRY – <span className="text-red-600">{route(cableEntry)}</span>
          </td>
        </tr>
        <tr>
          <td colSpan={3} className={cell}>
            CABLE EXIT – <span className="text-red-600">{route(cableExit)}</span>
          </td>
        </tr>
        <tr>
          <td colSpan={3} className={cell}>
            {[formText ? `FORM ${formText}` : null, stdText].filter(Boolean).join(", ") || "—"}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function BayColumn({
  vertical,
  bayNumber,
  readOnly,
  pxPerMm,
  panelHeightMm,
  bayLeftMm,
  isSelected,
  selectedPlacedId,
  selectedUnitIndex,
  cableEntry,
  cableExit,
  onSelectBay,
  onSelectFeeder,
  onMoveBay,
  onMoveFeeder,
  onHover,
  onHoverEnd,
  onRemove,
}: {
  vertical: VerticalWithFeeders;
  bayNumber: number | null;
  readOnly: boolean;
  pxPerMm: number;
  panelHeightMm: number;
  bayLeftMm: number;
  isSelected: boolean;
  selectedPlacedId: string | null;
  selectedUnitIndex: number;
  cableEntry: "Top" | "Bottom" | null;
  cableExit: "Top" | "Bottom" | null;
  onSelectBay: () => void;
  onSelectFeeder: (placedId: string, unitIndex: number) => void;
  onMoveBay: (direction: "left" | "right") => void;
  onMoveFeeder: (placedId: string, unitIndex: number, direction: "up" | "down") => void;
  onHover: (extent: HoverExtent) => void;
  onHoverEnd: () => void;
  onRemove: (placedId: string, unitIndex: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bay-${vertical.id}`, disabled: readOnly });

  const widthMm = vertical.width_mm ?? 0;
  const widthPx = widthMm * pxPerMm;
  const heightPx = panelHeightMm * pxPerMm;
  const compartments = computeCompartments(vertical, panelHeightMm);

  return (
    <div
      ref={setNodeRef}
      onClick={onSelectBay}
      data-ga-selectable=""
      className={`relative shrink-0 cursor-pointer border bg-white ${isOver ? "border-primary" : isSelected ? "border-2 border-primary" : "border-black/70"}`}
      style={{ width: Math.max(widthPx, 2), height: Math.max(heightPx, 2) }}
    >
      {isSelected && !readOnly && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveBay("left");
            }}
            title="Move bay left"
            className="absolute left-1/2 top-1 z-30 flex h-6 w-6 -translate-x-[calc(100%+2px)] items-center justify-center rounded-full border border-primary bg-surface-container-lowest text-primary shadow-sm hover:bg-primary/10"
          >
            <Icon name="chevron_left" size={16} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveBay("right");
            }}
            title="Move bay right"
            className="absolute left-1/2 top-1 z-30 flex h-6 w-6 translate-x-[2px] items-center justify-center rounded-full border border-primary bg-surface-container-lowest text-primary shadow-sm hover:bg-primary/10"
          >
            <Icon name="chevron_right" size={16} />
          </button>
        </>
      )}
      {compartments.map((c, ci) => {
        // compartment tag as on a GA drawing: <bay>F<n> top to bottom
        // (blank/dummy spaces included), with its height in modules (1M = 100mm)
        const tag = bayNumber != null ? `${bayNumber}F${ci + 1}` : null;
        const modules = c.heightMm % 100 === 0 ? `${c.heightMm / 100}M` : `${c.heightMm}mm`;
        // one unit at a time: a row of 4 merged MCCBs is 4 separate units
        const isFeederSelected = c.placedId === selectedPlacedId && (c.isBlank || (c.unitIndex ?? 0) === selectedUnitIndex);
        return (
          <DraggableCell
            key={c.id}
            dragId={`placed-${vertical.id}::${c.placedId}::${c.unitIndex ?? 0}`}
            disabled={readOnly || c.isBlank}
            onClick={(e) => {
              e.stopPropagation();
              onSelectFeeder(c.placedId!, c.unitIndex ?? 0);
            }}
            onMouseEnter={() => onHover({ topMm: c.topMm, heightMm: c.heightMm, bayLeftMm, bayWidthMm: widthMm, label: c.label })}
            onMouseLeave={onHoverEnd}
            title={`${c.label} — ${widthMm}mm × ${c.heightMm}mm`}
            className={`group relative flex items-center justify-center border-b px-1 text-center last:border-b-0 ${
              isFeederSelected ? "border-2 border-primary" : "border-black/40"
            } ${c.isBlank ? "bg-surface-container-low/50" : "bg-white hover:bg-amber-50"}`}
            style={{ height: Math.max(c.heightMm * pxPerMm, 1) }}
          >
            <span className="truncate font-telemetry-md text-[9px] uppercase tracking-wide text-black">{c.label}</span>
            {tag && c.heightMm * pxPerMm >= 14 && (
              <>
                <span className="pointer-events-none absolute bottom-0 left-0.5 font-mono text-[8px] font-bold leading-none text-black">{tag}</span>
                <span className="pointer-events-none absolute bottom-0 right-0.5 font-mono text-[8px] leading-none text-black/70">{modules}</span>
              </>
            )}
            {!c.isBlank && !readOnly && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(c.placedId!, c.unitIndex ?? 0);
                }}
                title="Move back to available feeders"
                className="absolute right-0.5 top-0.5 text-error opacity-0 group-hover:opacity-100"
              >
                <Icon name="close" size={10} />
              </button>
            )}
            {isFeederSelected && !readOnly && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveFeeder(c.placedId!, c.unitIndex ?? 0, "up");
                  }}
                  title="Move feeder up"
                  className="absolute -top-3 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-primary bg-surface-container-lowest text-primary shadow-sm hover:bg-primary/10"
                >
                  <Icon name="keyboard_arrow_up" size={16} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveFeeder(c.placedId!, c.unitIndex ?? 0, "down");
                  }}
                  title="Move feeder down"
                  className="absolute -bottom-3 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-primary bg-surface-container-lowest text-primary shadow-sm hover:bg-primary/10"
                >
                  <Icon name="keyboard_arrow_down" size={16} />
                </button>
              </>
            )}
          </DraggableCell>
        );
      })}
      {vertical.bay_type === "incomer" && cableEntry && (
        <div
          title={`Cable entry — ${cableEntry.toLowerCase()}`}
          className="pointer-events-auto absolute left-1/2 z-10 h-1.5 w-3/4 -translate-x-1/2 bg-blue-600"
          style={cableEntry === "Top" ? { top: 0 } : { bottom: 0 }}
        />
      )}
      {vertical.bay_type === "outgoing" && cableExit && (
        <div
          title={`Cable exit — ${cableExit.toLowerCase()}`}
          className="pointer-events-auto absolute left-1/2 z-10 h-1.5 w-3/4 -translate-x-1/2 bg-purple-600"
          style={cableExit === "Top" ? { top: 0 } : { bottom: 0 }}
        />
      )}
    </div>
  );
}

// Editable height for the main horizontal busbar chamber -- selected by
// clicking its bar in the drawing, mutually exclusive with a bay selection.
function BusbarDetailsPanel({
  height,
  readOnly,
  onHeightChange,
  onClose,
}: {
  height: number;
  readOnly: boolean;
  onHeightChange: (value: number) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState(String(height));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="font-label-sm text-label-sm uppercase tracking-wide text-secondary">Busbar Chamber</p>
        <button onClick={onClose} title="Deselect" className="text-secondary hover:text-on-surface">
          <Icon name="close" size={14} />
        </button>
      </div>
      <label className="mb-2 block">
        <span className="mb-1 block text-[10px] font-medium text-on-surface-variant">Height</span>
        <div className="flex items-end gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={local}
            disabled={readOnly}
            onChange={(e) => setLocal(e.target.value)}
            onKeyDown={numericKeyGuard()}
            onBlur={() => {
              const num = Math.max(1, Math.round(Number(local) || height));
              setLocal(String(num));
              onHeightChange(num);
            }}
            className="w-20 rounded border border-surface-container-high px-2 py-1 text-sm disabled:bg-surface-container-low"
          />
          <span className="pb-1.5 text-xs text-on-surface-variant">mm</span>
        </div>
      </label>
      <p className="text-[11px] leading-snug text-on-surface-variant">
        Height of the main horizontal busbar chamber, spanning the full width of the switchboard.
      </p>
    </div>
  );
}

// Editable name/type/width/depth for whichever bay is currently selected
// -- lives in the right sidebar instead of a header above each bay, which
// used to throw off the drawing's alignment with the ruler.
// Right-sidebar panel for a clicked compartment: a feeder unit (height,
// send back to the available list) or the bay's blank/DUMMY space (height).
function PlacedItemPanel({
  bay,
  placedId,
  unitIndex,
  panelHeightMm,
  readOnly,
  onUnitHeight,
  onDummyHeight,
  onRemove,
  onClose,
}: {
  bay: VerticalWithFeeders;
  placedId: string;
  unitIndex: number;
  panelHeightMm: number;
  readOnly: boolean;
  onUnitHeight: (heightMm: number | null) => void;
  onDummyHeight: (heightMm: number | null) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const isDummy = placedId.endsWith("::dummy");
  const row = bay.placed.find((p) => p.id === placedId) ?? null;
  const compartments = computeCompartments(bay, panelHeightMm);
  const current = compartments.find((c) => (isDummy ? c.isBlank : c.placedId === placedId && (c.unitIndex ?? 0) === unitIndex));
  const custom = isDummy ? bay.dummy_height_mm : (row?.unit_heights?.[unitIndex] ?? null);
  const standard = row ? compartmentHeightFor(row.feeder) : null;
  const [local, setLocal] = useState(custom != null ? String(custom) : "");
  const usedMm = compartments.reduce((s, c) => s + c.heightMm, 0);
  const overflow = usedMm - panelHeightMm;

  function commit() {
    const n = Math.round(Number(local));
    const value = local.trim() === "" || !(n > 0) ? null : n;
    if (isDummy) onDummyHeight(value);
    else if (row) onUnitHeight(value === standard ? null : value);
  }

  if (!isDummy && !row) return null;
  return (
    <div className="mb-4 border-b border-surface-container-high pb-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-label-sm text-label-sm uppercase tracking-wide text-secondary">{isDummy ? "Blank space" : "Feeder"}</p>
        <button onClick={onClose} title="Deselect" className="text-secondary hover:text-on-surface">
          <Icon name="close" size={14} />
        </button>
      </div>
      <p className="text-sm font-semibold text-on-surface">{isDummy ? blankCompartmentLabel(bay.bay_type) : row!.feeder.name}</p>
      <p className="mb-3 text-[11px] text-on-surface-variant">
        {bay.name}
        {!isDummy && row!.qty > 1 ? ` · unit ${unitIndex + 1} of ${row!.qty}` : ""}
        {current ? ` · ${current.heightMm}mm now` : ""}
      </p>

      <label className="mb-1 block">
        <span className="mb-1 block text-[10px] font-medium text-on-surface-variant">Height (mm){custom != null ? " •" : ""}</span>
        <input
          type="text"
          inputMode="decimal"
          value={local}
          disabled={readOnly}
          placeholder={isDummy ? "fills the space left" : `${standard} (standard)`}
          onChange={(e) => setLocal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            else numericKeyGuard()(e);
          }}
          onBlur={commit}
          className="w-full rounded border border-surface-container-high px-2 py-1 text-sm disabled:bg-surface-container-low"
        />
      </label>
      <p className="mb-2 text-[11px] leading-snug text-on-surface-variant">
        {isDummy
          ? "Leave empty to fill whatever height the feeders leave."
          : `This unit only — other units of the same feeder keep their own height. Remembered if you send it back to the feeder list. Standard: ${standard}mm.`}
      </p>
      {!readOnly && custom != null && (
        <button
          onClick={() => {
            setLocal("");
            if (isDummy) onDummyHeight(null);
            else onUnitHeight(null);
          }}
          className="btn btn-outline btn-sm mb-2 w-full"
        >
          <Icon name="restart_alt" size={14} /> {isDummy ? "Fill remaining height" : "Use standard height"}
        </button>
      )}
      {overflow > 0 && (
        <p className="mb-2 flex gap-1 text-[11px] leading-snug text-error">
          <Icon name="warning" size={12} className="mt-0.5" />
          This bay&apos;s compartments add up to {usedMm}mm — {overflow}mm more than the {panelHeightMm}mm panel.
        </p>
      )}
      {!isDummy && !readOnly && (
        <button onClick={onRemove} className="btn btn-outline btn-sm w-full text-error">
          <Icon name="undo" size={14} /> Remove from bay (back to feeder list)
        </button>
      )}
    </div>
  );
}

function BayDetailsPanel({
  vertical,
  readOnly,
  onRename,
  onDimChange,
  onDelete,
  onClose,
}: {
  vertical: VerticalWithFeeders | null;
  readOnly: boolean;
  onRename: (name: string) => void;
  onDimChange: (field: "width_mm" | "depth_mm", value: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [localName, setLocalName] = useState(vertical?.name ?? "");
  const [localWidth, setLocalWidth] = useState(vertical?.width_mm ? String(vertical.width_mm) : "");
  const [localDepth, setLocalDepth] = useState(vertical?.depth_mm ? String(vertical.depth_mm) : "");

  if (!vertical) {
    return (
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        Click a bay in the drawing to edit its name, type, and dimensions here, and to reposition it (drag arrows appear on the bay, or use the
        Left/Right arrow keys). Click a feeder within a bay to reorder it (Up/Down arrow keys).
      </p>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="font-label-sm text-label-sm uppercase tracking-wide text-secondary">Bay Details</p>
        <button onClick={onClose} title="Deselect" className="text-secondary hover:text-on-surface">
          <Icon name="close" size={14} />
        </button>
      </div>
      <label className="mb-2 block">
        <span className="mb-1 block text-[10px] font-medium text-on-surface-variant">Name</span>
        <input
          value={localName}
          disabled={readOnly}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={() => onRename(localName)}
          className="w-full rounded border border-surface-container-high px-2 py-1 text-sm disabled:bg-surface-container-low"
        />
      </label>
      {vertical.bay_type && (
        <span className="mb-2 inline-block rounded border border-surface-container-high bg-surface-container-low px-1.5 py-0.5 text-[10px] capitalize text-secondary">
          {vertical.bay_type.replace("_", " ")}
        </span>
      )}
      <div className="mb-3 flex items-end gap-2">
        <label>
          <span className="mb-1 block text-[10px] font-medium text-on-surface-variant">Width</span>
          <input
            type="text"
            inputMode="decimal"
            value={localWidth}
            disabled={readOnly}
            onChange={(e) => setLocalWidth(e.target.value)}
            onKeyDown={numericKeyGuard()}
            onBlur={() => onDimChange("width_mm", localWidth)}
            className="w-20 rounded border border-surface-container-high px-2 py-1 text-sm disabled:bg-surface-container-low"
          />
        </label>
        <label>
          <span className="mb-1 block text-[10px] font-medium text-on-surface-variant">Depth</span>
          <input
            type="text"
            inputMode="decimal"
            value={localDepth}
            disabled={readOnly}
            onChange={(e) => setLocalDepth(e.target.value)}
            onKeyDown={numericKeyGuard()}
            onBlur={() => onDimChange("depth_mm", localDepth)}
            className="w-20 rounded border border-surface-container-high px-2 py-1 text-sm disabled:bg-surface-container-low"
          />
        </label>
        <span className="pb-1.5 text-xs text-on-surface-variant">mm</span>
      </div>
      {!readOnly && (
        <button onClick={onDelete} className="font-body-sm text-body-sm text-error hover:underline">
          Delete bay
        </button>
      )}
    </div>
  );
}
