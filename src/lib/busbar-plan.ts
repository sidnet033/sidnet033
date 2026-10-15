import type { BayType, Feeder } from "@/types/database";
import type { BayFunction } from "@/lib/artuk-sizing";

// Busbar routing + sizing for a switchboard's GA, computed live from the
// bays/feeders on every render so it always follows the current layout.
// Only what a user deliberately changes is persisted (busbar_overrides),
// keyed by each segment's anchor -- see segmentKey().
//
// Coordinates are millimetres in the FRONT VIEW, origin at the top-left of
// the [busbar chamber + panel] block (the plinth is below and never carries
// busbar). x runs left→right across the bays, y runs top→bottom.

export type BusbarKind = "incomer_cable_link" | "incomer_riser" | "main" | "dropper" | "feeder_link" | "acb_link";
export type BusbarMaterial = "Cu" | "Al";
export type BarSize = { widthMm: number; thicknessMm: number };
export type Point = { x: number; y: number };

export const KIND_LABELS: Record<BusbarKind, string> = {
  incomer_cable_link: "Incomer cable link",
  incomer_riser: "Incomer riser",
  main: "Main busbar",
  dropper: "Dropper",
  feeder_link: "Feeder link",
  acb_link: "ACB link",
};

// The only flats we buy, per material (width × thickness, mm). Auto-sizing
// picks from these and every place a user can change a bar size offers
// only these. Shown on the Dimensions Master page. Beyond the largest
// single bar the plan adds parallel runs per phase.
const bars = (list: [number, number][]): BarSize[] =>
  list.map(([widthMm, thicknessMm]) => ({ widthMm, thicknessMm })).sort((a, b) => barArea(a) - barArea(b));

export const BAR_SIZES: Record<BusbarMaterial, BarSize[]> = {
  Cu: bars([
    [20, 10],
    [30, 10],
    [40, 10],
    [50, 10],
    [60, 10],
    [80, 10],
    [100, 10],
    [120, 10],
    [160, 10],
  ]),
  Al: bars([
    [20, 10],
    [30, 6],
    [40, 10],
    [50, 10],
    [60, 10],
    [80, 10],
    [100, 10],
    [125, 10],
    [150, 10],
    [160, 10],
  ]),
};

export function isStockedBar(material: BusbarMaterial, bar: BarSize): boolean {
  return BAR_SIZES[material].some((b) => b.widthMm === bar.widthMm && b.thicknessMm === bar.thicknessMm);
}

export const MAX_RUNS_PER_PHASE = 6;
const PREFERRED_MAX_RUNS = 4;

// kg per mm³
export const MATERIAL_DENSITY: Record<BusbarMaterial, number> = { Cu: 8.96e-6, Al: 2.7e-6 };

// The incomer's cable-termination bar runs front-to-back for 75% of the bay
// depth so the customer's incoming cables can be lugged onto it.
export const INCOMER_CABLE_LINK_DEPTH_FRACTION = 0.75;

export type BusbarOverride = {
  kind: BusbarKind;
  verticalId: string | null;
  placedFeederId: string | null;
  unitIndex: number;
  barWidthMm: number | null;
  barThicknessMm: number | null;
  runsPerPhase: number | null;
  lengthMm: number | null;
};

export function segmentKey(kind: BusbarKind, verticalId: string | null, placedFeederId: string | null, unitIndex: number): string {
  return `${kind}|${verticalId ?? ""}|${placedFeederId ?? ""}|${unitIndex}`;
}

export function overrideKey(o: Pick<BusbarOverride, "kind" | "verticalId" | "placedFeederId" | "unitIndex">): string {
  return segmentKey(o.kind, o.verticalId, o.placedFeederId, o.unitIndex);
}

export function barArea(bar: BarSize): number {
  return bar.widthMm * bar.thicknessMm;
}

export function formatBar(bar: BarSize | null, runs: number): string {
  if (!bar) return "—";
  const size = `${bar.widthMm}×${bar.thicknessMm}`;
  return runs > 1 ? `${runs}×(${size})` : size;
}

// "Incomer"/"Sub-Incomer" -> incomer, "Outgoing" -> outgoing, "Bus Coupler"
// -> bus_coupler, read off the feeder's category.
export function bayFunctionOf(feeder: Feeder): BayFunction | null {
  const cat = (feeder.category ?? "").toLowerCase();
  if (cat.includes("bus coupler")) return "bus_coupler";
  if (cat.includes("incomer")) return "incomer";
  if (cat.includes("outgoing")) return "outgoing";
  return null;
}

// Smallest stocked bar (fewest runs first, up to 4) whose cross-section
// carries `currentA` at `densityAPerMm2`. Above 4 × the largest bar it keeps
// adding runs of the largest bar.
export function autoSize(currentA: number | null, densityAPerMm2: number, material: BusbarMaterial): { bar: BarSize; runs: number } | null {
  if (currentA == null || currentA <= 0 || densityAPerMm2 <= 0) return null;
  const sizes = BAR_SIZES[material];
  const required = currentA / densityAPerMm2;
  for (let runs = 1; runs <= PREFERRED_MAX_RUNS; runs++) {
    const bar = sizes.find((b) => barArea(b) * runs >= required);
    if (bar) return { bar, runs };
  }
  const largest = sizes[sizes.length - 1];
  return { bar: largest, runs: Math.min(MAX_RUNS_PER_PHASE, Math.ceil(required / barArea(largest))) };
}

export type BusbarSegment = {
  key: string;
  kind: BusbarKind;
  verticalId: string | null;
  placedFeederId: string | null;
  unitIndex: number;
  title: string;
  fromLabel: string;
  toLabel: string;
  // Front-view polyline (mm). A single point is a bar that runs straight
  // into the depth of the panel (the incomer cable link) -- drawn as a marker.
  path: Point[];
  // Side-view position (mm from the front face / top of chamber+panel block).
  side: { y: number; x1: number; x2: number } | null;
  designCurrentA: number | null;
  requiredAreaMm2: number | null;
  auto: { bar: BarSize; runs: number } | null;
  bar: BarSize | null;
  runs: number;
  neutral: { bar: BarSize; runs: number } | null;
  autoLengthMm: number;
  lengthMm: number;
  overridden: { size: boolean; runs: boolean; length: boolean };
  capacityA: number | null;
  undersized: boolean;
  weightKg: number | null;
  notes: string[];
  warnings: string[];
};

export type PlanCompartment = {
  placedId: string;
  unitIndex: number;
  topMm: number;
  heightMm: number;
};

export type PlanBay = {
  id: string;
  name: string;
  bayType: BayType | null;
  widthMm: number;
  depthMm: number | null;
  leftMm: number;
  placed: { id: string; qty: number; feeder: Feeder }[];
  compartments: PlanCompartment[];
};

export type BusbarPlanInput = {
  bays: PlanBay[];
  panelHeightMm: number;
  chamberHeightMm: number;
  chamberPosition: "top" | "bottom";
  material: BusbarMaterial;
  densityAPerMm2: number;
  poles: number;
  neutralPct: number;
  switchboardAmps: number | null;
  defaultDepthMm: number;
  overrides: Record<string, BusbarOverride>;
};

export type BusbarPlan = {
  segments: BusbarSegment[];
  chamberMidY: number;
  totalWeightKg: number;
  warnings: string[];
};

type DraftSegment = Omit<
  BusbarSegment,
  "key" | "requiredAreaMm2" | "auto" | "bar" | "runs" | "neutral" | "lengthMm" | "overridden" | "capacityA" | "undersized" | "weightKg"
>;

function isAlley(t: BayType | null) {
  return t === "busbar_alley" || t === "cable_alley";
}

export function planBusbars(input: BusbarPlanInput): BusbarPlan {
  const { bays, panelHeightMm, chamberHeightMm, chamberPosition, material, densityAPerMm2, poles, neutralPct, overrides } = input;
  const chamberTop = chamberPosition === "top" ? 0 : panelHeightMm;
  const panelTop = chamberPosition === "top" ? chamberHeightMm : 0;
  const chamberMidY = chamberTop + chamberHeightMm / 2;
  const totalWidth = bays.reduce((s, b) => s + b.widthMm, 0);
  const planWarnings: string[] = [];
  const drafts: DraftSegment[] = [];

  // Incomer rating(s) decide the main busbar when the switchboard itself has
  // no Amps rating set.
  const incomerRatings: number[] = [];
  for (const bay of bays) {
    for (const p of bay.placed) {
      if (isIncomer(p.feeder, bay) && p.feeder.rated_current != null) incomerRatings.push(p.feeder.rated_current);
    }
  }
  const mainCurrent = input.switchboardAmps ?? (incomerRatings.length ? Math.max(...incomerRatings) : null);
  if (input.switchboardAmps == null) {
    planWarnings.push(
      mainCurrent != null
        ? `Switchboard Amps not set — main busbar sized on the incomer rating (${mainCurrent}A).`
        : "Switchboard Amps not set and no rated incomer found — main busbar can't be sized. Set Amps in Project Detail."
    );
  }

  if (bays.length > 0 && totalWidth > 0) {
    drafts.push({
      kind: "main",
      verticalId: null,
      placedFeederId: null,
      unitIndex: 0,
      title: KIND_LABELS.main,
      fromLabel: bays[0].name,
      toLabel: bays[bays.length - 1].name,
      path: [
        { x: 0, y: chamberMidY },
        { x: totalWidth, y: chamberMidY },
      ],
      side: null,
      designCurrentA: mainCurrent,
      autoLengthMm: totalWidth,
      notes: [`Runs the full ${totalWidth}mm width of the switchboard in the busbar chamber.`],
      warnings: mainCurrent == null ? ["No design current — set the switchboard's Amps in Project Detail."] : [],
    });
  }

  // Terminal of a device facing the main busbar chamber, and the one facing
  // away from it (where incoming cables land on an incomer).
  const nearChamberY = (c: PlanCompartment) => (chamberPosition === "top" ? panelTop + c.topMm : panelTop + c.topMm + c.heightMm);
  const awayFromChamberY = (c: PlanCompartment) => (chamberPosition === "top" ? panelTop + c.topMm + c.heightMm : panelTop + c.topMm);
  const centreY = (c: PlanCompartment) => panelTop + c.topMm + c.heightMm / 2;

  type DropperGroup = { host: PlanBay; x: number; insideBay: boolean; links: { bay: PlanBay; c: PlanCompartment; feeder: Feeder }[] };
  const droppers = new Map<string, DropperGroup>();

  bays.forEach((bay, i) => {
    if (isAlley(bay.bayType) || bay.widthMm <= 0) return;
    const centreX = bay.leftMm + bay.widthMm / 2;
    for (const c of bay.compartments) {
      const placed = bay.placed.find((p) => p.id === c.placedId);
      if (!placed) continue;
      const f = placed.feeder;
      if ((f.category ?? "").toLowerCase() === "spare") continue;
      const unitName = placed.qty > 1 ? `${f.name} #${c.unitIndex + 1}` : f.name;
      const noRating = f.rated_current == null ? ["No rated current on this feeder — set it in BOM Builder to size this bar."] : [];

      if (isIncomer(f, bay)) {
        const current = f.rated_current ?? mainCurrent;
        const terminalY = nearChamberY(c);
        drafts.push({
          kind: "incomer_riser",
          verticalId: null,
          placedFeederId: c.placedId,
          unitIndex: c.unitIndex,
          title: `${KIND_LABELS.incomer_riser} — ${unitName}`,
          fromLabel: `${unitName} (outgoing terminal)`,
          toLabel: KIND_LABELS.main,
          path: [
            { x: centreX, y: terminalY },
            { x: centreX, y: chamberMidY },
          ],
          side: null,
          designCurrentA: current,
          autoLengthMm: Math.round(Math.abs(chamberMidY - terminalY)),
          notes: ["Connects the incomer's outgoing terminal to the main horizontal busbar."],
          warnings: f.rated_current == null ? ["No rated current on the incomer — sized on the main busbar rating."] : [],
        });
        const depth = bay.depthMm ?? input.defaultDepthMm;
        const cableY = awayFromChamberY(c);
        drafts.push({
          kind: "incomer_cable_link",
          verticalId: null,
          placedFeederId: c.placedId,
          unitIndex: c.unitIndex,
          title: `${KIND_LABELS.incomer_cable_link} — ${unitName}`,
          fromLabel: "Incoming cables",
          toLabel: `${unitName} (incoming terminal)`,
          path: [{ x: centreX, y: cableY }],
          side: { y: cableY, x1: depth * 0.15, x2: depth * (0.15 + INCOMER_CABLE_LINK_DEPTH_FRACTION) },
          designCurrentA: current,
          autoLengthMm: Math.round(depth * INCOMER_CABLE_LINK_DEPTH_FRACTION),
          notes: [`Cable-termination bar, ${INCOMER_CABLE_LINK_DEPTH_FRACTION * 100}% of the ${depth}mm bay depth, for lugging the customer's incoming cables.`],
          warnings: bay.depthMm == null ? [`Bay depth not set — assumed ${input.defaultDepthMm}mm.`] : [],
        });
        continue;
      }

      const fn = bayFunctionOf(f);
      if (f.device_type === "ACB" || fn === "bus_coupler") {
        const terminalY = nearChamberY(c);
        drafts.push({
          kind: "acb_link",
          verticalId: null,
          placedFeederId: c.placedId,
          unitIndex: c.unitIndex,
          title: `${KIND_LABELS.acb_link} — ${unitName}`,
          fromLabel: KIND_LABELS.main,
          toLabel: unitName,
          path: [
            { x: centreX, y: chamberMidY },
            { x: centreX, y: terminalY },
          ],
          side: null,
          designCurrentA: f.rated_current,
          autoLengthMm: Math.round(Math.abs(chamberMidY - terminalY)),
          notes: ["Outgoing ACB fed straight off the main busbar — no dropper needed."],
          warnings: [...noRating, ...(fn === "bus_coupler" ? ["Bus coupler: busbar sectioning isn't modelled yet — drawn as a single link."] : [])],
        });
        continue;
      }

      // Dropper host: the busbar alley right next to this bay (right-hand
      // neighbour first), else a vertical run inside the bay itself.
      const right = bays[i + 1];
      const left = bays[i - 1];
      const alley = right?.bayType === "busbar_alley" ? right : left?.bayType === "busbar_alley" ? left : null;
      const host = alley ?? bay;
      let group = droppers.get(host.id);
      if (!group) {
        const x = alley ? alley.leftMm + alley.widthMm / 2 : bay.leftMm + bay.widthMm - Math.min(60, bay.widthMm * 0.12);
        group = { host, x, insideBay: !alley, links: [] };
        droppers.set(host.id, group);
      }
      group.links.push({ bay, c, feeder: f });
      const towardDropper = group.x >= centreX ? bay.leftMm + bay.widthMm : bay.leftMm;
      const terminalX = (towardDropper + centreX) / 2;
      drafts.push({
        kind: "feeder_link",
        verticalId: null,
        placedFeederId: c.placedId,
        unitIndex: c.unitIndex,
        title: `${KIND_LABELS.feeder_link} — ${unitName}`,
        fromLabel: `${KIND_LABELS.dropper} (${host.name})`,
        toLabel: unitName,
        path: [
          { x: group.x, y: centreY(c) },
          { x: terminalX, y: centreY(c) },
        ],
        side: null,
        designCurrentA: f.rated_current,
        autoLengthMm: Math.round(Math.abs(group.x - terminalX)),
        notes: ["Feeder busbar from the dropper to this outgoing device's incoming terminal."],
        warnings: noRating,
      });
    }
  });

  for (const group of droppers.values()) {
    const ys = group.links.map((l) => centreY(l.c));
    const farY = chamberPosition === "top" ? Math.max(...ys) : Math.min(...ys);
    const sum = group.links.reduce((s, l) => s + (l.feeder.rated_current ?? 0), 0);
    const unrated = group.links.filter((l) => l.feeder.rated_current == null).length;
    const capped = mainCurrent != null && sum > mainCurrent;
    const current = sum > 0 ? (capped ? mainCurrent : sum) : null;
    const servedBays = Array.from(new Set(group.links.map((l) => l.bay.name)));
    drafts.push({
      kind: "dropper",
      verticalId: group.host.id,
      placedFeederId: null,
      unitIndex: 0,
      title: `${KIND_LABELS.dropper} — ${group.host.name}`,
      fromLabel: KIND_LABELS.main,
      toLabel: `${group.links.length} feeder(s) in ${servedBays.join(", ")}`,
      path: [
        { x: group.x, y: chamberMidY },
        { x: group.x, y: farY },
      ],
      side: null,
      designCurrentA: current,
      autoLengthMm: Math.round(Math.abs(farY - chamberMidY)),
      notes: [
        `Sized on the full sum of the feeders it serves (${sum}A, no diversity)${capped ? `, capped at the ${mainCurrent}A main busbar rating` : ""}.`,
      ],
      warnings: [
        ...(group.insideBay ? [`No busbar alley next to ${group.host.name} — dropper drawn inside the bay. Add a Busbar Alley beside it.`] : []),
        ...(unrated > 0 ? [`${unrated} served feeder(s) have no rated current and were left out of the sum.`] : []),
      ],
    });
  }

  const order: Record<BusbarKind, number> = { incomer_cable_link: 0, incomer_riser: 1, main: 2, acb_link: 3, dropper: 4, feeder_link: 5 };
  drafts.sort((a, b) => order[a.kind] - order[b.kind]);

  const hasNeutral = poles >= 4;
  const segments = drafts.map((d) => finishSegment(d, { material, densityAPerMm2, hasNeutral, neutralPct, overrides }));
  const totalWeightKg = segments.reduce((s, seg) => s + (seg.weightKg ?? 0), 0);
  return { segments, chamberMidY, totalWeightKg, warnings: planWarnings };
}

function isIncomer(feeder: Feeder, bay: Pick<PlanBay, "bayType">): boolean {
  const fn = bayFunctionOf(feeder);
  if (fn === "incomer") return true;
  return bay.bayType === "incomer" && fn !== "outgoing" && fn !== "bus_coupler";
}

function finishSegment(
  d: DraftSegment,
  ctx: { material: BusbarMaterial; densityAPerMm2: number; hasNeutral: boolean; neutralPct: number; overrides: Record<string, BusbarOverride> }
): BusbarSegment {
  const key = segmentKey(d.kind, d.verticalId, d.placedFeederId, d.unitIndex);
  const o = ctx.overrides[key];
  const auto = autoSize(d.designCurrentA, ctx.densityAPerMm2, ctx.material);
  const sizeOverridden = !!o && o.barWidthMm != null && o.barThicknessMm != null;
  const runsOverridden = !!o && o.runsPerPhase != null;
  const lengthOverridden = !!o && o.lengthMm != null;
  const bar = sizeOverridden ? { widthMm: o!.barWidthMm!, thicknessMm: o!.barThicknessMm! } : (auto?.bar ?? null);
  const runs = runsOverridden ? o!.runsPerPhase! : (auto?.runs ?? 1);
  const lengthMm = lengthOverridden ? o!.lengthMm! : d.autoLengthMm;

  let neutral: { bar: BarSize; runs: number } | null = null;
  if (ctx.hasNeutral && bar) {
    neutral = ctx.neutralPct >= 100 ? { bar, runs } : autoSize(d.designCurrentA != null ? (d.designCurrentA * ctx.neutralPct) / 100 : null, ctx.densityAPerMm2, ctx.material);
  }

  const capacityA = bar ? Math.round(barArea(bar) * runs * ctx.densityAPerMm2) : null;
  const undersized = capacityA != null && d.designCurrentA != null && capacityA < d.designCurrentA;
  const phaseArea = bar ? barArea(bar) * runs * 3 : 0;
  const neutralArea = neutral ? barArea(neutral.bar) * neutral.runs : 0;
  const weightKg = bar ? Math.round((phaseArea + neutralArea) * lengthMm * MATERIAL_DENSITY[ctx.material] * 100) / 100 : null;

  return {
    ...d,
    key,
    requiredAreaMm2: d.designCurrentA != null ? Math.round(d.designCurrentA / ctx.densityAPerMm2) : null,
    auto,
    bar,
    runs,
    neutral,
    lengthMm,
    overridden: { size: sizeOverridden, runs: runsOverridden, length: lengthOverridden },
    capacityA,
    undersized,
    weightKg,
    warnings: [
      ...d.warnings,
      ...(undersized ? [`Undersized: carries ${capacityA}A at ${ctx.densityAPerMm2} A/mm² vs ${d.designCurrentA}A needed.`] : []),
      ...(bar && !isStockedBar(ctx.material, bar) ? [`${bar.widthMm}×${bar.thicknessMm} isn't a stocked ${ctx.material} size — pick one from the list.`] : []),
    ],
  };
}
