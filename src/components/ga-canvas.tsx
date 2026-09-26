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
  ACB_SIZES,
  DEVICE_TYPE_LABELS,
  MCC_FRONT_ACCESS_PAIR,
  OUTGOING_MCC_BAY,
  lookupAcbBaySpec,
  lookupFeederBoxHeight,
  suggestAcbFrame,
  type AcbFrame,
  type BayFunction,
} from "@/lib/artuk-sizing";

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

// Elevation drawing scale. The busbar chamber has no real height in our
// data model yet -- BUSBAR_CHAMBER_HEIGHT_MM is a nominal value used only
// so the drawing's proportions and ruler stay consistent.
const BUSBAR_CHAMBER_HEIGHT_MM = 100;
const DEFAULT_COMPARTMENT_HEIGHT_MM = 150;
const DRAWING_TARGET_HEIGHT_PX = 520;
const MIN_PX_PER_MM = 0.12;
const MAX_PX_PER_MM = 0.6;
const RULER_WIDTH_PX = 44;

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

type Compartment = { id: string; label: string; heightMm: number; topMm: number; isBlank: boolean; placedId?: string };

function blankCompartmentLabel(bayType: BayType | null): string {
  if (bayType === "cable_alley") return "CABLE ALLEY";
  if (bayType === "busbar_alley") return "BUSBAR ALLEY";
  return "DUMMY";
}

// Placed feeders stack top-to-bottom by tier_number (this is the first
// place tier_number actually drives visual order), each sized by its real
// ArTuK height when the feeder has a device_type set, else a flat fallback
// slot so something always renders. Unused height at the bottom of the bay
// becomes a labeled blank compartment instead of stretching the last one.
function computeCompartments(vertical: VerticalWithFeeders, panelHeightMm: number): Compartment[] {
  const sorted = [...vertical.placed].sort((a, b) => a.tier_number - b.tier_number || a.sort_order - b.sort_order);
  const compartments: Compartment[] = [];
  let used = 0;
  for (const p of sorted) {
    const heightMm = lookupFeederBoxHeight(p.feeder) ?? DEFAULT_COMPARTMENT_HEIGHT_MM;
    compartments.push({ id: p.id, placedId: p.id, label: p.feeder.name, heightMm, topMm: used, isBlank: false });
    used += heightMm;
  }
  const remaining = panelHeightMm - used;
  if (remaining > 0) {
    compartments.push({ id: `${vertical.id}-blank`, label: blankCompartmentLabel(vertical.bay_type), heightMm: remaining, topMm: used, isBlank: true });
  }
  return compartments;
}

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
      `${otherClassified.length} feeder(s) (${types.join(", ")}) pack into ArTuK's standard ${OUTGOING_MCC_BAY.widthMm}×${OUTGOING_MCC_BAY.depthMm}mm outgoing module, stacked by each feeder's rated height (see Dimensions Master).`
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
    placed: [],
  };
}

function placeUnit(verticalId: string, feeder: Feeder, tierNumber: number, sortOrder: number): PlacedWithFeeder {
  return {
    id: newId(),
    vertical_id: verticalId,
    feeder_id: feeder.id,
    label_override: null,
    qty: 1,
    sort_order: sortOrder,
    tier_number: tierNumber,
    created_at: new Date().toISOString(),
    feeder,
  };
}

// "Incomer"/"Sub-Incomer" -> incomer, "Outgoing" -> outgoing, "Bus Coupler"
// -> bus_coupler. "APFC Capacitor Bank" and unclassified feeders have no
// ArTuK sizing data at all, so they're left for auto-generation to skip.
function bayFunctionOf(feeder: Feeder): BayFunction | null {
  const cat = (feeder.category ?? "").toLowerCase();
  if (cat.includes("bus coupler")) return "bus_coupler";
  if (cat.includes("incomer")) return "incomer";
  if (cat.includes("outgoing")) return "outgoing";
  return null;
}

// One entry per physical unit across the whole board (every bay + the
// unassigned bucket) -- Auto-generate GA rebuilds the layout from scratch
// each time it runs, same one-card-per-unit model already used for
// AvailableUnit. Alley bays are skipped since they never hold feeders.
function collectAllUnits(verts: VerticalWithFeeders[]): Feeder[] {
  const units: Feeder[] = [];
  for (const v of verts) {
    if (v.bay_type === "cable_alley" || v.bay_type === "busbar_alley") continue;
    for (const p of v.placed) {
      for (let i = 0; i < p.qty; i++) units.push(p.feeder);
    }
  }
  return units;
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
  const [panelHeight, setPanelHeight] = useState(2100);
  const [savedPanelHeight, setSavedPanelHeight] = useState(2100);
  const [saving, setSaving] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const [search, setSearch] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [draggingFeeder, setDraggingFeeder] = useState<Feeder | null>(null);
  const [hover, setHover] = useState<HoverExtent>(null);
  const [selectedBayId, setSelectedBayId] = useState<string | null>(null);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [sizingLogicOpen, setSizingLogicOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);

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

  const totalHeightMm = BUSBAR_CHAMBER_HEIGHT_MM + panelHeight + plinthHeight;
  const pxPerMm = computePxPerMm(totalHeightMm);
  const selectedBay = bays.find((v) => v.id === selectedBayId) ?? null;

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

  // Manual alternates to what Auto-generate GA picks by default (see
  // artuk-sizing.ts's default policy) -- empty bays the user drags
  // feeders into by hand, same as any other bay template.
  function addMccFrontAccessPair() {
    if (!sb || readOnly) return;
    const primary = makeVertical(sb.id, "MCC Front Access", "outgoing", MCC_FRONT_ACCESS_PAIR.primary.widthMm, MCC_FRONT_ACCESS_PAIR.primary.depthMm, bays.length);
    const paired = makeVertical(sb.id, "MCC Front Access", "outgoing", MCC_FRONT_ACCESS_PAIR.paired.widthMm, MCC_FRONT_ACCESS_PAIR.paired.depthMm, bays.length + 1);
    setVerticals([...verticals, primary, paired]);
  }

  function add2TierOutgoingE12() {
    if (!sb || readOnly) return;
    const primary = makeVertical(sb.id, "Outgoing (E1.2 2-Tier)", "outgoing", ACB_2TIER_OUTGOING_E12.primary.widthMm, ACB_2TIER_OUTGOING_E12.primary.depthMm, bays.length);
    const paired = makeVertical(sb.id, "Outgoing (E1.2 2-Tier)", "outgoing", ACB_2TIER_OUTGOING_E12.paired.widthMm, ACB_2TIER_OUTGOING_E12.paired.depthMm, bays.length + 1);
    setVerticals([...verticals, primary, paired]);
  }

  // Rebuilds the whole bay layout from the BOM's feeders using ArTuK's
  // standard sizing (see artuk-sizing.ts) -- ACB incomer/outgoing/bus-
  // coupler units each get their own correctly-sized bay (pairing E1.2
  // outgoing units two-at-a-time into the more space-efficient 2-tier
  // combo), everything else with a device type set bin-packs by height
  // into shared 720w rear-access MCC bays, and anything unclassified (or
  // missing a rating) lands in the unassigned bucket instead of being
  // guessed at. Cable Alley / Busbar Alley bays are never touched.
  function autoGenerateGa() {
    if (!sb || readOnly) return;
    if (bays.length > 0) {
      const proceed = window.confirm(
        "This replaces your current bay layout. Cable Alley / Busbar Alley bays you've added manually are kept. Continue?"
      );
      if (!proceed) return;
    }

    const keptAlleys = bays
      .filter((v) => v.bay_type === "cable_alley" || v.bay_type === "busbar_alley")
      .sort((a, b) => a.sort_order - b.sort_order);

    const { unassigned } = withUnassigned(verticals, sb.id);
    const allUnits = collectAllUnits(verticals);

    const acbGroups = new Map<string, Feeder[]>();
    const nonAcbUnits: Feeder[] = [];
    const unplaced: Feeder[] = [];

    for (const feeder of allUnits) {
      if (feeder.device_type === "ACB") {
        const fn = bayFunctionOf(feeder);
        if (!fn || feeder.rated_current == null) {
          unplaced.push(feeder);
          continue;
        }
        const frame = suggestAcbFrame(feeder.rated_current);
        const key = `${frame}::${fn}`;
        const arr = acbGroups.get(key) ?? [];
        arr.push(feeder);
        acbGroups.set(key, arr);
      } else if (feeder.device_type && feeder.device_type !== "OTHER") {
        if (lookupFeederBoxHeight(feeder) != null) nonAcbUnits.push(feeder);
        else unplaced.push(feeder);
      } else {
        unplaced.push(feeder);
      }
    }

    const generated: VerticalWithFeeders[] = [];
    let sortOrder = keptAlleys.length;

    // E1.2 outgoing ACBs pair up two-at-a-time into the 2-tier combo bay --
    // any leftover odd unit falls back to the plain single-bay spec below.
    const e12OutgoingKey = "E1.2::outgoing";
    const e12Outgoing = acbGroups.get(e12OutgoingKey) ?? [];
    acbGroups.delete(e12OutgoingKey);
    let i = 0;
    for (; i + 1 < e12Outgoing.length; i += 2) {
      const primary = makeVertical(sb.id, `Outgoing ${sortOrder + 1}`, "outgoing", ACB_2TIER_OUTGOING_E12.primary.widthMm, ACB_2TIER_OUTGOING_E12.primary.depthMm, sortOrder++);
      primary.placed = [placeUnit(primary.id, e12Outgoing[i], 1, 0)];
      generated.push(primary);
      const paired = makeVertical(sb.id, `Outgoing ${sortOrder + 1}`, "outgoing", ACB_2TIER_OUTGOING_E12.paired.widthMm, ACB_2TIER_OUTGOING_E12.paired.depthMm, sortOrder++);
      paired.placed = [placeUnit(paired.id, e12Outgoing[i + 1], 1, 0)];
      generated.push(paired);
    }
    if (i < e12Outgoing.length) {
      acbGroups.set(e12OutgoingKey, [e12Outgoing[i]]);
    }

    for (const [key, feeders] of acbGroups) {
      const [frame, fn] = key.split("::") as [AcbFrame, BayFunction];
      let spec = lookupAcbBaySpec(frame, fn);
      if (!spec) {
        // No dedicated ArTuK bay-spec row for this combination (only
        // happens for E4.2/E6.2 bus-coupler, absent from the source's 11
        // sample rows) -- fall back to the device's own generic
        // dimensions, using the same 1037mm depth as the rest of the board.
        const bracket = ACB_SIZES.find((b) => b.frame === frame);
        if (bracket) {
          spec = { frame, function: fn, widthMm: bracket.width4P100, heightMm: 2231, depthMm: 1037, ipRating: 54, form: "4b", label: `${frame} ${fn} (generic -- no ArTuK bay-spec row for this combination)` };
        }
      }
      if (!spec) {
        unplaced.push(...feeders);
        continue;
      }
      const namePrefix = fn === "incomer" ? "Incomer" : fn === "bus_coupler" ? "Bus Coupler" : "Outgoing";
      const bayTypeMap: Record<BayFunction, BayType> = { incomer: "incomer", outgoing: "outgoing", bus_coupler: "bus_coupler" };
      for (const feeder of feeders) {
        const primary = makeVertical(sb.id, `${namePrefix} ${sortOrder + 1}`, bayTypeMap[fn], spec.widthMm, spec.depthMm, sortOrder++);
        primary.placed = [placeUnit(primary.id, feeder, 1, 0)];
        generated.push(primary);
        if (spec.pairedWith) {
          const paired = makeVertical(sb.id, spec.pairedWith.name ?? `${namePrefix} ${sortOrder + 1}`, spec.pairedWith.bayType, spec.pairedWith.widthMm, spec.depthMm, sortOrder++);
          generated.push(paired);
        }
      }
    }

    // Bin-pack every non-ACB classified feeder (largest first) into shared
    // 720w rear-access MCC bays, using the switchboard's panel height minus
    // a flat 200mm top/bottom clearance allowance as the usable height.
    const usableHeight = (panelHeight || 2231) - 200;
    const sortedNonAcb = [...nonAcbUnits].sort((a, b) => (lookupFeederBoxHeight(b) ?? 0) - (lookupFeederBoxHeight(a) ?? 0));
    let currentBay: VerticalWithFeeders | null = null;
    let currentHeightUsed = 0;
    let currentTier = 1;
    for (const feeder of sortedNonAcb) {
      const h = lookupFeederBoxHeight(feeder)!;
      if (!currentBay || currentHeightUsed + h > usableHeight) {
        currentBay = makeVertical(sb.id, `Outgoing ${sortOrder + 1}`, "outgoing", OUTGOING_MCC_BAY.widthMm, OUTGOING_MCC_BAY.depthMm, sortOrder++);
        generated.push(currentBay);
        currentHeightUsed = 0;
        currentTier = 1;
      }
      currentBay.placed.push(placeUnit(currentBay.id, feeder, currentTier, currentBay.placed.length));
      currentHeightUsed += h;
      currentTier++;
    }

    const unplacedQtyByFeeder = new Map<string, { feeder: Feeder; qty: number }>();
    for (const feeder of unplaced) {
      const existing = unplacedQtyByFeeder.get(feeder.id);
      if (existing) existing.qty += 1;
      else unplacedQtyByFeeder.set(feeder.id, { feeder, qty: 1 });
    }
    const unassignedBay: VerticalWithFeeders = {
      ...unassigned,
      placed: Array.from(unplacedQtyByFeeder.values()).map((u, idx) => ({
        id: newId(),
        vertical_id: unassigned.id,
        feeder_id: u.feeder.id,
        label_override: null,
        qty: u.qty,
        sort_order: idx,
        tier_number: 1,
        created_at: new Date().toISOString(),
        feeder: u.feeder,
      })),
    };

    setVerticals([...keptAlleys, ...generated, unassignedBay]);
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

  const busbarLabel = `BUSBAR CHAMBER${sb.amps ? ` · ${sb.amps}A` : ""}${sb.ka ? ` · ${sb.ka}kA` : ""} · ${sb.busbar ?? "Cu"}`;

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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

        <div ref={fullscreenRef} className="relative flex flex-1 gap-4 overflow-hidden bg-surface p-4">
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen canvas"}
            className="absolute right-5 top-5 z-10 flex items-center gap-1 rounded-md border border-surface-container-high bg-surface-container-lowest px-2 py-1.5 text-on-surface-variant shadow-sm hover:bg-surface-container-low hover:text-on-surface"
          >
            <Icon name={isFullscreen ? "fullscreen_exit" : "fullscreen"} size={16} />
          </button>
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
            {!readOnly && sb?.std === "ArTuK" && (
              <div className="mb-3">
                <button
                  onClick={autoGenerateGa}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary shadow-sm hover:bg-primary-container"
                >
                  <Icon name="auto_awesome" size={14} className="mr-1 inline" /> Auto-generate GA
                </button>
                <p className="mt-1 text-[11px] text-on-surface-variant">
                  Builds bays from the BOM&rsquo;s feeders using ArTuK standard sizing. Give each feeder a Device Type and rating in BOM Builder
                  first -- see Dimensions Master for how sizes are worked out. You can still edit any bay afterward.
                </p>
              </div>
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

            <div className="flex-1 overflow-auto rounded-xl border border-surface-container-high bg-surface-container-low/40 p-4">
              {bays.length === 0 ? (
                <p className="w-full py-10 text-center text-sm text-on-surface-variant">
                  No bays yet — add one from the Modular Bay Templates above.
                </p>
              ) : (
                <div className="inline-block">
                  {sb.std === "ArTuK" && (
                    <div className="flex">
                      <div style={{ width: RULER_WIDTH_PX }} />
                      <div
                        className="flex items-center justify-center bg-red-600 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-white"
                        style={{ width: totalWidth * pxPerMm }}
                      >
                        ArTuK
                      </div>
                    </div>
                  )}

                  {busbarPosition === "top" && (
                    <div className="flex">
                      <div style={{ width: RULER_WIDTH_PX }} />
                      <DrawingBar label={busbarLabel} heightPx={BUSBAR_CHAMBER_HEIGHT_MM * pxPerMm} widthPx={totalWidth * pxPerMm} />
                    </div>
                  )}

                  <div className="flex">
                    <VerticalRuler totalHeightMm={panelHeight} pxPerMm={pxPerMm} hover={hover} />
                    <div className="flex">
                      {bays.map((v, i) => (
                        <BayColumn
                          key={`${v.id}-${resetKey}`}
                          vertical={v}
                          readOnly={readOnly}
                          pxPerMm={pxPerMm}
                          panelHeightMm={panelHeight}
                          bayLeftMm={bayOffsets[i]}
                          isSelected={selectedBayId === v.id}
                          onSelect={() => setSelectedBayId(v.id)}
                          onHover={setHover}
                          onHoverEnd={() => setHover(null)}
                          onRemove={(placedId) => removeFromBay(v.id, placedId)}
                        />
                      ))}
                    </div>
                  </div>

                  {busbarPosition === "bottom" && (
                    <div className="flex">
                      <div style={{ width: RULER_WIDTH_PX }} />
                      <DrawingBar label={busbarLabel} heightPx={BUSBAR_CHAMBER_HEIGHT_MM * pxPerMm} widthPx={totalWidth * pxPerMm} />
                    </div>
                  )}

                  <div className="flex">
                    <div style={{ width: RULER_WIDTH_PX }} />
                    <DrawingBar label={`PLINTH · ${plinthHeight}mm`} heightPx={plinthHeight * pxPerMm} widthPx={totalWidth * pxPerMm} />
                  </div>

                  <div className="flex">
                    <div style={{ width: RULER_WIDTH_PX }} />
                    <HorizontalRuler bayOffsets={bayOffsets} totalWidth={totalWidth} pxPerMm={pxPerMm} hover={hover} />
                  </div>
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
                  }}
                  onClose={() => setSelectedBayId(null)}
                />

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
                        How each bay&rsquo;s width and height were worked out, based on its placed feeders. See Dimensions Master for the
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
function DrawingBar({ label, heightPx, widthPx }: { label: string; heightPx: number; widthPx: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden border border-black/70 bg-white px-2 text-center font-telemetry-md text-[9px] font-semibold uppercase tracking-wide text-black"
      style={{ height: Math.max(heightPx, 16), width: Math.max(widthPx, 1) }}
    >
      {label}
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
function BayColumn({
  vertical,
  readOnly,
  pxPerMm,
  panelHeightMm,
  bayLeftMm,
  isSelected,
  onSelect,
  onHover,
  onHoverEnd,
  onRemove,
}: {
  vertical: VerticalWithFeeders;
  readOnly: boolean;
  pxPerMm: number;
  panelHeightMm: number;
  bayLeftMm: number;
  isSelected: boolean;
  onSelect: () => void;
  onHover: (extent: HoverExtent) => void;
  onHoverEnd: () => void;
  onRemove: (placedId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bay-${vertical.id}`, disabled: readOnly });

  const widthMm = vertical.width_mm ?? 0;
  const widthPx = widthMm * pxPerMm;
  const heightPx = panelHeightMm * pxPerMm;
  const compartments = computeCompartments(vertical, panelHeightMm);

  return (
    <div
      ref={setNodeRef}
      onClick={onSelect}
      className={`relative shrink-0 cursor-pointer border bg-white ${isOver ? "border-primary" : isSelected ? "border-2 border-primary" : "border-black/70"}`}
      style={{ width: Math.max(widthPx, 2), height: Math.max(heightPx, 2) }}
    >
      {compartments.map((c) => (
        <div
          key={c.id}
          onMouseEnter={() => onHover({ topMm: c.topMm, heightMm: c.heightMm, bayLeftMm, bayWidthMm: widthMm, label: c.label })}
          onMouseLeave={onHoverEnd}
          title={`${c.label} — ${widthMm}mm × ${c.heightMm}mm`}
          className={`group relative flex items-center justify-center overflow-hidden border-b border-black/40 px-1 text-center last:border-b-0 ${
            c.isBlank ? "bg-surface-container-low/50" : "bg-white hover:bg-amber-50"
          }`}
          style={{ height: Math.max(c.heightMm * pxPerMm, 1) }}
        >
          <span className="truncate font-telemetry-md text-[9px] uppercase tracking-wide text-black">{c.label}</span>
          {!c.isBlank && !readOnly && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(c.id);
              }}
              title="Move back to available feeders"
              className="absolute right-0.5 top-0.5 text-error opacity-0 group-hover:opacity-100"
            >
              <Icon name="close" size={10} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// Editable name/type/width/depth for whichever bay is currently selected
// -- lives in the right sidebar instead of a header above each bay, which
// used to throw off the drawing's alignment with the ruler.
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
    return <p className="font-body-sm text-body-sm text-on-surface-variant">Click a bay in the drawing to edit its name, type, and dimensions here.</p>;
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
