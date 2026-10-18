import type { BayType, Feeder, PlacedFeeder, Switchboard, Vertical } from "@/types/database";
import { ACB_SIZES, MCCB_SIZES, OUTGOING_MCC_BAY, lookupAcbBaySpec, lookupFeederBoxHeight, suggestAcbFrame } from "@/lib/artuk-sizing";
import { bayFunctionOf, overrideKey, planBusbars, type BusbarMaterial, type BusbarOverride, type BusbarPlan } from "@/lib/busbar-plan";

// GA layout rules shared by GA Builder (drawing, Update GA, busbar layer)
// and Project Detail's project-wide checks, so both always reach the same
// answer for the same switchboard.

export type VerticalWithFeeders = Vertical & {
  placed: (PlacedFeeder & { feeder: Feeder })[];
};

// Defaults used when a switchboard has no value set yet.
export const BUSBAR_CHAMBER_HEIGHT_MM = 100;
export const DEFAULT_PANEL_HEIGHT_MM = 2100;
export const DEFAULT_COMPARTMENT_HEIGHT_MM = 150;
export const DEFAULT_BAY_DEPTH_MM = 600;

// Every switchgear bay leaves a 60mm gap each side of its feeders: a 600mm
// wide feeder sits in a 720mm bay (drawn as dotted lines inside the bay).
export const FEEDER_SIDE_GAP_MM = 60;
// ArTuK: the red ArTuK strip on top is 25mm. An ArTuK height (from the
// ruleset) runs from the top of that strip to the bottom of the lowest
// feeder -- strip + busbar chamber + feeders -- and does NOT include the
// baseframe: a 2131 board on a 100mm baseframe stands 2231mm from the floor.
export const ARTUK_STRIP_MM = 25;
// ...and there's a 60mm level between the strip and the topmost contents,
// and between the bottommost contents and the baseframe.
export const ARTUK_LEVEL_GAP_MM = 60;
export const ARTUK_HEIGHTS_MM = [2131, 2231];
export const DEFAULT_ARTUK_HEIGHT_MM = 2231;

// Everything inside an ArTuK height other than the busbar chamber and the
// feeders: the strip and the two 60mm levels.
export const ARTUK_FIXED_MM = ARTUK_STRIP_MM + 2 * ARTUK_LEVEL_GAP_MM;

// The ArTuK height a switchboard was saved at (stored as its panel height,
// so recovered as panel + chamber + strip + levels), snapped to an allowed height.
export function artukHeightOf(panelMm: number | null, chamberMm: number): number {
  const h = panelMm != null ? panelMm + chamberMm + ARTUK_FIXED_MM : null;
  return h != null && ARTUK_HEIGHTS_MM.includes(h) ? h : DEFAULT_ARTUK_HEIGHT_MM;
}

// Panel (feeder) height actually used for a switchboard: on ArTuK, the
// ArTuK height less the strip and busbar chamber; otherwise the panel
// height set on the switchboard.
export function effectivePanelHeight(
  sb: Pick<Switchboard, "std" | "panel_height_mm" | "busbar_chamber_height_mm">,
  chamberMm: number = sb.busbar_chamber_height_mm ?? BUSBAR_CHAMBER_HEIGHT_MM
): number {
  if (sb.std === "ArTuK") return artukHeightOf(sb.panel_height_mm, chamberMm) - ARTUK_FIXED_MM - chamberMm;
  return sb.panel_height_mm ?? DEFAULT_PANEL_HEIGHT_MM;
}

// A feeder's own width (without the side gaps): an ACB is its ArTuK bay
// width less the gaps (E1.2/E2.2 600, E4.2 800...); an MCCB its rear
// mounting width; anything else the standard 600mm module.
export function feederWidthFor(feeder: Feeder): number {
  if (feeder.device_type === "ACB" && feeder.rated_current != null) {
    const frame = suggestAcbFrame(feeder.rated_current);
    const spec = lookupAcbBaySpec(frame, bayFunctionOf(feeder) ?? "outgoing");
    if (spec) return spec.widthMm - 2 * FEEDER_SIDE_GAP_MM;
    const bracket = ACB_SIZES.find((b) => b.frame === frame);
    if (bracket) return bracket.width4P100;
  }
  if (feeder.device_type === "MCCB" && feeder.rated_current != null) {
    const bracket = MCCB_SIZES.find((b) => feeder.rated_current! <= b.uptoAmps) ?? MCCB_SIZES[MCCB_SIZES.length - 1];
    return bracket.rearWidth;
  }
  return OUTGOING_MCC_BAY.widthMm - 2 * FEEDER_SIDE_GAP_MM;
}

// Typical depth a device takes up from the panel front (mm) -- the side
// view draws it this deep, with the busbars behind it.
export function deviceDepthFor(feeder: Feeder): number {
  switch (feeder.device_type) {
    case "ACB":
      return 450;
    case "MCCB":
      return 250;
    case "MCB":
      return 150;
    case "VFD":
    case "SOFT_STARTER":
      return 350;
    default:
      return 300;
  }
}

export function isAlley(bayType: BayType | null): boolean {
  return bayType === "cable_alley" || bayType === "busbar_alley";
}

// A bay's width is set by its widest feeder plus the two side gaps; null
// for empty bays (nothing to size from).
export function bayWidthFor(v: Pick<VerticalWithFeeders, "bay_type" | "placed">): number | null {
  if (v.bay_type === "unassigned" || v.placed.length === 0) return null;
  return Math.max(...v.placed.map((p) => feederWidthFor(p.feeder))) + 2 * FEEDER_SIDE_GAP_MM;
}

export type Compartment = { id: string; label: string; heightMm: number; topMm: number; isBlank: boolean; placedId?: string; unitIndex?: number };

export function blankCompartmentLabel(bayType: BayType | null): string {
  if (bayType === "cable_alley") return "CABLE ALLEY";
  if (bayType === "busbar_alley") return "BUSBAR ALLEY";
  return "DUMMY";
}

// Placed feeders stack top-to-bottom by tier_number (this is the first
// place tier_number actually drives visual order), each sized by its real
// ArTuK height when the feeder has a device_type set, else a flat fallback
// slot so something always renders. Unused height becomes a labeled blank
// ("DUMMY"/alley) compartment -- vertical.dummy_slot is a flat UNIT index
// (0..totalUnits, counting every individual unit of every row, not just
// rows), so the gap can sit anywhere, including between two units of the
// very same multi-qty row (four merged MCCBs, say), not just between two
// different rows. totalUnits means "after everything," the default.
// A placed unit's compartment height. ACBs aren't in the MCC stacking table
// (they get a dedicated ArTuK bay) -- their compartment is the Emax 2
// frame's own height from the ACB catalog, picked by rated current.
export function compartmentHeightFor(feeder: Feeder): number {
  if (feeder.device_type === "ACB" && feeder.rated_current != null) {
    const bracket = ACB_SIZES.find((b) => feeder.rated_current! <= b.uptoAmps) ?? ACB_SIZES[ACB_SIZES.length - 1];
    if (bracket.height != null) return bracket.height;
  }
  return lookupFeederBoxHeight(feeder) ?? DEFAULT_COMPARTMENT_HEIGHT_MM;
}

// One unit's height: the height the user set for that particular unit in GA
// Builder (placed_feeders.unit_heights[unitIndex]), else the catalogue height.
export function unitHeightFor(row: Pick<PlacedFeeder, "unit_heights"> & { feeder: Feeder }, unitIndex: number): number {
  const custom = row.unit_heights?.[unitIndex];
  return custom != null && Number(custom) > 0 ? Number(custom) : compartmentHeightFor(row.feeder);
}

// The blank/DUMMY space fills whatever height is left, unless the bay has
// its own dummy_height_mm -- then it's that tall and any height still left
// over simply stays empty at the bottom.
export function computeCompartments(vertical: VerticalWithFeeders, panelHeightMm: number): Compartment[] {
  const sorted = [...vertical.placed].sort((a, b) => a.tier_number - b.tier_number || a.sort_order - b.sort_order);
  let usedByRows = 0;
  for (const p of sorted) for (let u = 0; u < p.qty; u++) usedByRows += unitHeightFor(p, u);
  const customDummy = vertical.dummy_height_mm != null ? Number(vertical.dummy_height_mm) : null;
  const dummyHeight = customDummy ?? panelHeightMm - usedByRows;
  const totalUnits = sorted.reduce((sum, p) => sum + p.qty, 0);
  const dummySlot = Math.min(Math.max(vertical.dummy_slot ?? totalUnits, 0), totalUnits);
  const dummyId = `${vertical.id}::dummy`;

  const compartments: Compartment[] = [];
  let used = 0;
  let unitIndex = 0;
  const maybePushDummy = () => {
    if (unitIndex === dummySlot && dummyHeight > 0) {
      compartments.push({ id: dummyId, placedId: dummyId, label: blankCompartmentLabel(vertical.bay_type), heightMm: dummyHeight, topMm: used, isBlank: true });
      used += dummyHeight;
    }
  };
  for (const p of sorted) {
    // A placed_feeders row with qty > 1 (several units of the same feeder
    // merged into one bay) is that many separate physical devices -- each
    // gets its own compartment, not one compartment for the whole row.
    for (let u = 0; u < p.qty; u++) {
      maybePushDummy();
      const heightMm = unitHeightFor(p, u);
      compartments.push({ id: `${p.id}::${u}`, placedId: p.id, unitIndex: u, label: p.feeder.name, heightMm, topMm: used, isBlank: false });
      used += heightMm;
      unitIndex++;
    }
  }
  maybePushDummy();
  return compartments;
}


// The width/depth Update GA gives a bay on an ArTuK-standard switchboard,
// read from its placed feeders -- null when nothing in the bay drives a size
// (alleys, the unassigned bucket, empty or unclassified bays, an ACB with
// no rated current).
export function artukBaySize(v: VerticalWithFeeders): { widthMm: number; depthMm: number } | null {
  if (v.bay_type === "cable_alley" || v.bay_type === "busbar_alley" || v.bay_type === "unassigned") return null;
  const acbUnits = v.placed.filter((p) => p.feeder.device_type === "ACB");
  if (acbUnits.length > 0) {
    const p = acbUnits[0];
    if (p.feeder.rated_current == null) return null;
    const frame = suggestAcbFrame(p.feeder.rated_current);
    const fn = bayFunctionOf(p.feeder) ?? "outgoing";
    const spec = lookupAcbBaySpec(frame, fn);
    if (spec) return { widthMm: spec.widthMm, depthMm: spec.depthMm };
    // No dedicated ArTuK bay-spec row for this combination (only happens for
    // E4.2/E6.2 bus-coupler, absent from the source's 11 sample rows) -- fall
    // back to the device's own generic dimensions, using the same 1037mm
    // depth as the rest of the board.
    const bracket = ACB_SIZES.find((b) => b.frame === frame);
    return bracket ? { widthMm: bracket.width4P100, depthMm: 1037 } : null;
  }
  const hasOtherClassified = v.placed.some((p) => p.feeder.device_type && p.feeder.device_type !== "ACB" && p.feeder.device_type !== "OTHER");
  return hasOtherClassified ? { widthMm: OUTGOING_MCC_BAY.widthMm, depthMm: OUTGOING_MCC_BAY.depthMm } : null;
}

export type BusbarOverrideRow = {
  kind: BusbarOverride["kind"];
  vertical_id: string | null;
  placed_feeder_id: string | null;
  unit_index: number;
  bar_width_mm: number | null;
  bar_thickness_mm: number | null;
  runs_per_phase: number | null;
  length_mm: number | null;
  start_ext_mm?: number | null;
  end_ext_mm?: number | null;
};

export function overridesFromRows(rows: BusbarOverrideRow[]): Record<string, BusbarOverride> {
  const overrides: Record<string, BusbarOverride> = {};
  for (const r of rows) {
    const o: BusbarOverride = {
      kind: r.kind,
      verticalId: r.vertical_id,
      placedFeederId: r.placed_feeder_id,
      unitIndex: r.unit_index,
      barWidthMm: r.bar_width_mm != null ? Number(r.bar_width_mm) : null,
      barThicknessMm: r.bar_thickness_mm != null ? Number(r.bar_thickness_mm) : null,
      runsPerPhase: r.runs_per_phase,
      lengthMm: r.length_mm != null ? Number(r.length_mm) : null,
      startExtMm: r.start_ext_mm != null ? Number(r.start_ext_mm) : null,
      endExtMm: r.end_ext_mm != null ? Number(r.end_ext_mm) : null,
    };
    overrides[overrideKey(o)] = o;
  }
  return overrides;
}

export type BusbarParams = Pick<Switchboard, "busbar" | "amps" | "poles" | "neutral_size_pct" | "cable_entry">;

// Physically the busbar chamber sits away from wherever cables enter the
// panel (more room to route cable near the entry side).
export function chamberPositionFor(cableEntry: Switchboard["cable_entry"]): "top" | "bottom" {
  return cableEntry === "Top" ? "bottom" : "top";
}

export function planForSwitchboard(args: {
  params: BusbarParams;
  verticals: VerticalWithFeeders[];
  overrides: Record<string, BusbarOverride>;
  densities: Record<BusbarMaterial, number>;
  panelHeightMm: number;
  chamberHeightMm: number;
}): BusbarPlan {
  const bays = args.verticals.filter((v) => v.bay_type !== "unassigned").sort((a, b) => a.sort_order - b.sort_order);
  const material: BusbarMaterial = args.params.busbar ?? "Cu";
  let left = 0;
  return planBusbars({
    bays: bays.map((v) => {
      const leftMm = left;
      left += v.width_mm ?? 0;
      return {
        id: v.id,
        name: v.name,
        bayType: v.bay_type as BayType | null,
        widthMm: v.width_mm ?? 0,
        depthMm: v.depth_mm,
        leftMm,
        placed: v.placed.map((p) => ({ id: p.id, qty: p.qty, feeder: p.feeder as Feeder })),
        compartments: computeCompartments(v, args.panelHeightMm)
          .filter((c) => !c.isBlank && c.placedId)
          .map((c) => ({ placedId: c.placedId!, unitIndex: c.unitIndex ?? 0, topMm: c.topMm, heightMm: c.heightMm })),
      };
    }),
    panelHeightMm: args.panelHeightMm,
    chamberHeightMm: args.chamberHeightMm,
    chamberPosition: chamberPositionFor(args.params.cable_entry),
    material,
    densityAPerMm2: args.densities[material],
    poles: args.params.poles ?? 4,
    neutralPct: args.params.neutral_size_pct ?? 100,
    switchboardAmps: args.params.amps,
    defaultDepthMm: Math.max(0, ...bays.map((v) => v.depth_mm ?? 0)) || DEFAULT_BAY_DEPTH_MM,
    overrides: args.overrides,
  });
}
