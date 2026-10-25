import type { SupabaseClient } from "@supabase/supabase-js";
import type { BayType, Feeder, PlacedFeeder, Switchboard, Vertical } from "@/types/database";
import { suggestAcbFrame } from "@/lib/artuk-sizing";
import { effectiveNetRate } from "@/lib/feeder-cost";
import { bayFunctionOf, breakerFrameOf, type BusbarMaterial, type BusbarPlan } from "@/lib/busbar-plan";
import { planBusbarSupports } from "@/lib/busbar-supports";
import {
  ARTUK_FIXED_MM,
  BUSBAR_CHAMBER_HEIGHT_MM,
  artukHeightOf,
  computeCompartments,
  effectivePanelHeight,
  overridesFromRows,
  planForSwitchboard,
  type BusbarOverrideRow,
  type VerticalWithFeeders,
} from "@/lib/ga-layout";

// ArTuK enclosure BOM, built from the GA bay by bay with ABB's part codes.
// Rules follow the kit lists on ABB's assembly guideline (WK-003, one page
// per standard bay) and the part catalogue (Standard BOM BOM-12-04-2023);
// every part is priced from Item Master (category "ArTuK Enclosure"),
// matched by part code = SKU. Computed live, never stored.
//
// Per bay (a "structure"; a 1467mm-deep bay is two structures, 1030 + 437):
//  - top/base set by width x depth, N°4 uprights and (switchgear bays) N°2
//    functional frames by upright height (2000/1800/1600),
//  - front door: glass for switchgear bays, metal for cable/busbar alleys;
//    rear: hinged rear door (rear access) or rear cover (front access),
//  - screws (AD1033-1 x5, APR14/20 x3), internal hinges (AD1090),
//  - busbar supports: counted and placed by busbar-supports.ts (span by kA
//    and material, per-bay minimums, part by runs per phase),
//  - ACB bays: ACB kit + segregation kit by frame and bay width, 4
//    segregation shelves, rear segregation 200x4 + 300x2 + 400x1, cross-
//    pieces TV1005-1 x4 and TV1211-1 (x2 on 920w and wider); bus couplers
//    add the internal bus riser parts,
//  - MCC bays: per MCCB a mounting kit + segregation kit by compartment
//    height; other devices a blind panel with cutout + back plate; 3
//    shelves, horizontal bus segregation, rear segregation 100 + 300,
//    crosspieces, and droppers' busbar supports,
//  - blank / DUMMY spaces and the busbar chamber: blind panel + back plate.
// Per line-up: side panels only on the two ends -- the leftmost bay's left
// side and the rightmost bay's right side, each at that bay's own depth;
// bays in between get none (one N°2 pair when both ends match), lifting
// eyebolts, and for every joint between bays a coupling kit (AD1014) and
// lifting reinforcement (SA1350-1).
// Internal arc (ABB ELSP/ARTU-K/ENGG/04): top/base sets with arc flap and
// gland plate (…-FG), 2mm louvred rear panels where ABB lists one, at least
// 4 supports on every vertical busbar; 2mm side panels / glass doors and
// recessed compartment doors have no separate code in ABB's list -- flagged.
// Not modelled (add by hand): roof filters / louvred rear doors for
// ventilation (per incomer rating), IP31/IP41 finishing kits, corner sets,
// double-front ICC.

export type EnclosureLine = { code: string; qty: number; why: string[] };

const WIDTH_PREFIX: Record<number, string> = { 420: "VC30", 510: "SK40", 720: "SK60", 920: "SK80", 1120: "SK10", 1320: "SK12" };
// external depth of a base set -> code digits
const DEPTH_CODE: Record<number, string> = { 430: "50", 630: "60", 830: "80", 1030: "10", 1230: "12" };
const BASE_DEPTHS = [430, 630, 830, 1030, 1230];
// usable (inner) width of a bay: bay width less 2 x 60mm
const innerWidth = (w: number) => w - 120;

function isAlley(t: BayType | null) {
  return t === "cable_alley" || t === "busbar_alley";
}

// A bay's depth as ArTuK structures: 1467 = 1030 + 437, otherwise one set
// (1037 -> 1030, 637 -> 630, 837 -> 830, 1237 -> 1230).
export function depthSections(depthMm: number): number[] {
  if (depthMm >= 1400) return [1030, 430];
  const d = depthMm - 7;
  return [BASE_DEPTHS.reduce((best, x) => (Math.abs(x - d) < Math.abs(best - d) ? x : best), BASE_DEPTHS[0])];
}

// glass/metal door and rear width digits by inner width
const DOOR_W: Record<number, string> = { 300: "33", 390: "41", 600: "61", 800: "82", 1000: "12" };
const METAL_DOOR_W: Record<number, string> = { 300: "33", 390: "41", 600: "61", 800: "81", 1000: "11" };
const REAR_W: Record<number, string> = { 300: "30", 390: "40", 600: "60", 800: "80", 1000: "10", 1200: "12" };
const SHELF: Record<number, string> = { 390: "SH4000-1", 450: "SH4500-1", 500: "SH5000-1", 600: "SH6000-1", 800: "SH8000-1", 1000: "SH1100-1", 1200: "SH1100/2-1" };
// rear (vertical busbar) segregation by inner width: [100, 200, 300, 400] high
const REAR_SEG: Record<number, [string, string, string, string]> = {
  500: ["SV1051-1", "SV2051-1", "SV2053-1", "SV2054-1"],
  600: ["SV1061-1", "SV2061-1", "SV2063-1", "SV2064-1"],
  800: ["SV1081-1", "SV2081-1", "SV2083-1", "SV2084-1"],
  1000: ["SV1010-1", "SV2010-1", "SV3010-1", "SV4010-1"],
  1200: ["SV1010/2-1", "SV2010/2-1", "SV3010/2-1", "SV4010/2-1"],
};
// side panel pair by base depth
const SIDE_D: Record<number, string> = { 430: "50", 630: "60", 830: "80", 1030: "10", 1230: "12" };

// Blind panel (front, "-1" plain / "-2" with cutout) and back plate codes
// for a compartment of height h (100-800) in a bay of inner width w.
function blindPanel(h: number, w: number, cutout: boolean): { panel: string; plate: string } | null {
  const n = h / 100;
  const v = cutout && h > 100 ? "2" : "1";
  switch (w) {
    case 390:
      return n <= 6 ? { panel: `PC${n}400-${v}`, plate: `PF${n}405-1` } : null;
    case 500:
      return n <= 8 ? { panel: `PC${n}500-${v}`, plate: `PF${n}505-1` } : null;
    case 600:
      return n <= 8 ? { panel: `PC${n}600-${v}`, plate: n === 1 ? "PF1005-1" : `PF${n}005-1` } : null;
    case 800:
      return n <= 6 ? { panel: `PC${n}800-${v}`, plate: `PF${n}805-1` } : null;
    case 1000:
      return n <= 6 ? { panel: `PC12${n}0-${v}`, plate: `PF${n}100-1` } : null;
    case 1200:
      return n <= 6 ? { panel: `PC12${n}0/2-${v}`, plate: `PF${n}100/2-1` } : null;
    default:
      return null;
  }
}

// Splits a height into the panel sizes ABB makes (100mm steps, largest
// first, up to `max`).
function splitHeight(h: number, max: number): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.round(h / 100) * 100);
  while (left > 0) {
    const take = Math.min(left, max);
    out.push(take);
    left -= take;
  }
  return out;
}

const ACB_KITS: { frame: string; width: number; kit: string; seg: string }[] = [
  { frame: "E1.2", width: 720, kit: "KN1866-1IN", seg: "FH_E12609-1" },
  { frame: "E1.2", width: 920, kit: "KN1866-1IN", seg: "FH_E12609-1" },
  { frame: "E2.2", width: 720, kit: "KN2666-1IN", seg: "FH_E22609-1" },
  { frame: "E2.2", width: 920, kit: "KN2668-1IN", seg: "FH_E22809-1" },
  { frame: "E4.2", width: 920, kit: "KN4868-1IN", seg: "FH_E42809-1" },
  { frame: "E6.2", width: 1120, kit: "KN6360-1IN", seg: "FH_E62109-1" },
  { frame: "E6.2", width: 1320, kit: "KN6361-1IN", seg: "FH_E62129-1" },
];

const MCCB_KIT: Record<number, string> = { 200: "H23KT200-1", 300: "H23KT300-1", 400: "H23KT400-1", 500: "H23KT500-1", 600: "H23KT600-1" };
// segregation kit by compartment height: 900 deep (1030 structures) / 500-700 deep
const SEG_900: Record<number, string> = { 200: "FH1020-1", 300: "FH1030-1", 400: "FH1040-1", 500: "FH1050-1", 600: "FH1060-1", 700: "FH1070-1", 800: "FH1080-1" };
const SEG_700: Record<number, string> = { 200: "FH3220-1", 300: "FH3430-1", 400: "FH3540-1", 500: "FH3650-1", 600: "FH3760-1", 700: "FH3770-1", 800: "FH3780-1" };

export type EnclosureInput = {
  verticals: VerticalWithFeeders[];
  plan: BusbarPlan | null;
  modularHeightMm: number;
  panelHeightMm: number;
  chamberHeightMm: number;
  frontAccess: boolean;
  poles: number;
  material: BusbarMaterial;
  ka: number | null;
  internalArc: boolean;
};

// top/base sets ABB makes with an arc flap + gland plate (or flap only)
const FLAP_SETS = new Set([
  "SK4080-1FG", "SK4010-1FG", "SK4012-1FG", "SK6080-1FG", "SK6010-1FG", "SK6012-1FG", "SK8080-1FG", "SK8010-1FG", "SK8012-1FG",
  "SK8080-2FG", "SK8010-2FG", "SK8012-2FG", "SK1060-2FG", "SK1080-2FG", "SK1010-1FG", "SK1010-2FG", "SK1012-1FG", "SK1012-2FG",
  "SK1260-2FG", "SK1280-2F", "SK1210-1FG", "SK1212-1FG", "SK1212-2FG",
]);
function flapSet(code: string): string | null {
  const stem = code.replace(/-1$/, "");
  return [`${stem}-1FG`, `${stem}-2FG`, `${stem}-2F`, `${stem}-1F`].find((c) => FLAP_SETS.has(c)) ?? null;
}

export function artukEnclosureBom(input: EnclosureInput): { lines: EnclosureLine[]; warnings: string[] } {
  const bays = input.verticals.filter((v) => v.bay_type !== "unassigned").sort((a, b) => a.sort_order - b.sort_order);
  const H = String(input.modularHeightMm / 100).padStart(2, "0"); // 20 / 18 / 16
  const lines = new Map<string, EnclosureLine>();
  const warnings: string[] = [];
  const add = (code: string | null | undefined, qty: number, why: string) => {
    if (!code || qty <= 0) return;
    const l = lines.get(code) ?? { code, qty: 0, why: [] };
    l.qty += qty;
    if (!l.why.includes(why)) l.why.push(why);
    lines.set(code, l);
  };

  // busbar supports, placed along the main busbar and droppers
  let left = 0;
  const supportBays = bays.map((v) => {
    const b = { id: v.id, name: v.name, leftMm: left, widthMm: v.width_mm ?? 0, depthMm: v.depth_mm };
    left += v.width_mm ?? 0;
    return b;
  });
  const mccbBoard = !bays.some((v) => v.placed.some((p) => p.feeder.device_type === "ACB"));
  const sup = planBusbarSupports({
    plan: input.plan,
    bays: supportBays,
    material: input.material,
    ka: input.ka,
    mccbBoard,
    internalArc: input.internalArc,
    poles: input.poles,
  });
  warnings.push(...sup.warnings);
  for (const s of sup.supports) {
    const what = `${s.bayName}: ${s.kind === "hbb" ? "main" : "vertical"} busbar support (span ≤${s.spanMm}mm)`;
    add(s.code, 1, what);
    add(s.neutralCode, 1, what);
  }
  if (input.internalArc) {
    warnings.push(
      "Internal arc: use 2mm side panels and glass doors, recessed compartment doors (gap ≤3mm), APR14/20 + AD1090 fixings, M12 8.8 busbar bolts at 70Nm, and ACB/MCCB conductor anchoring per ABB ENGG/03 — confirm the 2mm door/side-panel part codes with ABB."
    );
  }

  for (const bay of bays) {
    const w = bay.width_mm ?? 0;
    const name = bay.name;
    const prefix = WIDTH_PREFIX[w];
    const inner = innerWidth(w);
    const sections = depthSections(bay.depth_mm ?? 1037);
    const alley = isAlley(bay.bay_type as BayType | null);
    if (!prefix) {
      warnings.push(`${name}: ${w}mm isn't an ArTuK bay width (420/510/720/920/1120/1320) — its enclosure parts aren't listed.`);
      continue;
    }
    // structure
    sections.forEach((d, i) => {
      const set = `${prefix}${DEPTH_CODE[d]}-1`;
      const arcSet = input.internalArc && i === 0 && !alley ? flapSet(set) : null;
      if (input.internalArc && i === 0 && !alley && !arcSet) warnings.push(`${name}: no ABB top/base set with arc flap for ${w}x${d} — check with ABB.`);
      add(arcSet ?? set, 1, `${name}: top/base set ${w}x${d}${arcSet ? " with arc flap & gland plate" : ""}`);
      add(`SK${H}00-1`, 1, `${name}: uprights`);
      if (i > 0) {
        add("TV1251-1", 2, `${name}: ${d}mm depth extension`);
        add("TV5101-1", 4, `${name}: ${d}mm depth extension`);
      }
    });
    add("AD1033-1", 5, "screws, per bay");
    add("APR14/20", 3, "side/rear cover screws, per bay");

    if (alley) {
      add(`PO${H}${METAL_DOOR_W[inner] ?? "33"}-1`, 1, `${name}: metal door`);
      add(`RF${H}${REAR_W[inner] ?? "30"}-1${input.frontAccess ? "" : "H"}`, 1, `${name}: rear ${input.frontAccess ? "cover" : "door"}`);
      continue;
    }

    // switchgear bay: frames, door, rear, hinges
    add(`SK${H}02-1`, 1, `${name}: functional frames`);
    add(inner === 1200 ? (H === "20" ? "PV2012/2-1" : `PV${H}81/2-1`) : `PV${H}${DOOR_W[inner] ?? "61"}-1`, 1, `${name}: glass door`);
    const arcRear = input.internalArc && H === "20" && [600, 800].includes(inner) ? `RF20${REAR_W[inner]}-2H DML SPL` : null;
    if (input.internalArc && !arcRear) warnings.push(`${name}: no 2mm ABB rear panel listed for ${inner}mm — check with ABB.`);
    add(
      arcRear ??
        (inner === 1200 && H === "20" && !input.frontAccess ? "RF2012-2H" : `RF${H}${REAR_W[inner] ?? "60"}-1${input.frontAccess || inner === 1200 ? "" : "H"}`),
      1,
      `${name}: rear ${input.frontAccess ? "cover" : "door"}${arcRear ? " (2mm, internal arc)" : ""}`
    );
    add("AD1090", 1, `${name}: internal door hinges`);

    const compartments = computeCompartments(bay, input.panelHeightMm);
    const feederOf = (placedId?: string) => bay.placed.find((p) => p.id === placedId)?.feeder as Feeder | undefined;
    const acbs = compartments.map((c) => feederOf(c.placedId)).filter((f): f is Feeder => !!f && f.device_type === "ACB");
    const structureDepth = sections[0];
    const segKits = structureDepth >= 1030 ? SEG_900 : SEG_700;
    const seg = REAR_SEG[inner];

    // busbar chamber front: blind panels
    for (const h of splitHeight(input.chamberHeightMm, inner >= 1000 || inner === 800 ? 600 : 800)) {
      const bp = blindPanel(h, inner, false);
      add(bp?.panel, 1, `${name}: busbar chamber cover`);
      add(bp?.plate, 1, `${name}: busbar chamber cover`);
    }

    if (acbs.length > 0) {
      for (const f of acbs) {
        const frame = breakerFrameOf(f) ?? (f.rated_current != null ? suggestAcbFrame(f.rated_current) : null);
        const kit = ACB_KITS.find((k) => k.frame === frame && k.width === w) ?? ACB_KITS.find((k) => k.frame === frame);
        if (!kit) {
          warnings.push(`${name}: no ABB ACB kit for frame ${frame ?? "?"} — add it by hand.`);
          continue;
        }
        if (kit.width !== w) warnings.push(`${name}: ABB's ${frame} kit is for a ${kit.width}mm bay; this bay is ${w}mm.`);
        add(kit.kit, 1, `${name}: ${frame} ACB kit`);
        add(kit.seg, 1, `${name}: ${frame} ACB segregation kit`);
        if (bayFunctionOf(f) === "bus_coupler") {
          add(`VC${H}20-1`, 1, `${name}: bus coupler internal bus riser`);
          add("TR1205-1", 1, `${name}: bus coupler crosspieces`);
          add(H === "20" ? "AD1025-1" : H === "18" ? "AD1024-1" : "AD1023-1", 1, `${name}: bus riser rear segregation`);
          add(`SV${H}15-1`, 1, `${name}: bus riser side segregation`);
        }
      }
      add(SHELF[inner], 4, `${name}: busbar segregation shelves`);
      if (seg) {
        add(seg[1], 4, `${name}: rear segregation`);
        add(seg[2], 2, `${name}: rear segregation`);
        add(seg[3], 1, `${name}: rear segregation`);
      }
      add("TV1005-1", 4, `${name}: crosspieces (vertical)`);
      add("TV1211-1", w >= 920 ? 2 : 1, `${name}: crosspieces (under roof)`);
    } else {
      add(SHELF[inner], 3, `${name}: busbar segregation shelves`);
      add(structureDepth >= 1030 ? "SH1030-1" : "SH2030-1", 1, `${name}: horizontal bus segregation`);
      if (seg) {
        add(seg[0], 1, `${name}: rear segregation`);
        add(seg[2], 1, `${name}: rear segregation`);
      }
      add(structureDepth >= 1030 ? "TV1005-1" : "TV6005-1", 4, `${name}: crosspieces (vertical)`);
      add(structureDepth >= 1030 ? "TV1211-1" : "TV1261-1", 1, `${name}: crosspieces (under roof)`);
    }

    // compartments other than ACBs
    for (const c of compartments) {
      const f = feederOf(c.placedId);
      if (f?.device_type === "ACB") continue;
      const h = Math.round(c.heightMm / 100) * 100;
      if (f && f.device_type === "MCCB" && !c.isBlank) {
        add(MCCB_KIT[Math.min(600, Math.max(200, h))], 1, `${name}: MCCB mounting kit ${h}mm`);
        add(segKits[Math.min(800, Math.max(200, h))], 1, `${name}: MCCB segregation kit ${h}mm`);
        continue;
      }
      const device = f && !c.isBlank && (f.category ?? "").toLowerCase() !== "spare";
      for (const part of splitHeight(h, inner >= 1000 || inner === 800 ? 600 : 800)) {
        const bp = blindPanel(part, inner, !!device);
        if (!bp) {
          warnings.push(`${name}: no ABB blind panel for ${part}x${inner}mm — add it by hand.`);
          continue;
        }
        add(bp.panel, 1, `${name}: ${device ? `${f!.name} front plate` : "blank cover"}`);
        add(bp.plate, 1, `${name}: ${device ? `${f!.name} mounting plate` : "blank back plate"}`);
        if (device) add(segKits[Math.min(800, Math.max(200, part))], 1, `${name}: ${f!.name} segregation kit`);
      }
    }
  }

  // line-up
  if (bays.length > 0) {
    // ABB sells side panels as a pair (N°2): one pair covers both ends when
    // the end bays are the same depth; otherwise one pair per end depth,
    // each with a spare panel
    const leftEnd = depthSections(bays[0].depth_mm ?? 1037);
    const rightEnd = depthSections(bays[bays.length - 1].depth_mm ?? 1037);
    const same = leftEnd.length === rightEnd.length && leftEnd.every((d, i) => d === rightEnd[i]);
    if (same) {
      for (const d of leftEnd) add(`LF${H}${SIDE_D[d]}-1`, 1, `side panels: left of ${bays[0].name}, right of ${bays[bays.length - 1].name} (${d}mm)`);
    } else {
      for (const d of leftEnd) add(`LF${H}${SIDE_D[d]}-1`, 1, `side panel: left of ${bays[0].name} (${d}mm; pair — 1 spare)`);
      for (const d of rightEnd) add(`LF${H}${SIDE_D[d]}-1`, 1, `side panel: right of ${bays[bays.length - 1].name} (${d}mm; pair — 1 spare)`);
      warnings.push(`End bays ${bays[0].name} and ${bays[bays.length - 1].name} differ in depth — ABB side panels come in pairs, so one pair per end is listed (one spare panel each).`);
    }
    add("AA9610-1", 1, "lifting eyebolts");
    add("SA1350-1", Math.max(0, bays.length - 1), "lifting reinforcement per joint between bays");
    add("AD1014", Math.max(0, bays.length - 1), "coupling kit per joint between bays");
  }

  return { lines: [...lines.values()], warnings };
}

export type EnclosureTakeoffLine = EnclosureLine & {
  description: string;
  // GI / CRCA parts are priced by weight x the project's per-kg rate
  material: string | null;
  weightKg: number | null;
  rate: number;
  amount: number;
  inItemMaster: boolean;
  priced: boolean;
};

export type EnclosureTakeoff = {
  lines: EnclosureTakeoffLine[];
  total: number;
  unpriced: number;
  missing: number;
  warnings: string[];
};

type ProjectSettings = { busbar_density_cu: number; busbar_density_al: number; enclosure_rate_gi: number; enclosure_rate_crca: number };
export type SteelRates = { GI: number; CRCA: number };

// Loads the GA and prices the ArTuK enclosure BOM from Item Master. Null
// when the switchboard isn't ArTuK.
export async function loadEnclosureTakeoff(supabase: SupabaseClient, sb: Switchboard): Promise<EnclosureTakeoff | null> {
  if (sb.std !== "ArTuK") return null;
  const [{ data: vRows }, { data: oRows }, { data: rev }] = await Promise.all([
    supabase.from("verticals").select("*").eq("switchboard_id", sb.id).order("sort_order"),
    supabase.from("busbar_overrides").select("*").eq("switchboard_id", sb.id),
    supabase.from("revisions").select("project:projects(busbar_density_cu, busbar_density_al, enclosure_rate_gi, enclosure_rate_crca)").eq("id", sb.revision_id).single(),
  ]);
  const verticals = (vRows ?? []) as Vertical[];
  const vIds = verticals.map((v) => v.id);
  const { data: pRows } = vIds.length
    ? await supabase
        .from("placed_feeders")
        .select("*, feeder:feeders(*, feeder_items(item:item_master(category, frame)))")
        .in("vertical_id", vIds)
        .order("sort_order")
    : { data: [] };
  const placed = (pRows ?? []) as unknown as (PlacedFeeder & { feeder: Feeder })[];
  const withFeeders: VerticalWithFeeders[] = verticals.map((v) => ({ ...v, placed: placed.filter((p) => p.vertical_id === v.id) }));
  const project = (rev as unknown as { project: ProjectSettings | null } | null)?.project ?? null;
  const chamber = sb.busbar_chamber_height_mm ?? BUSBAR_CHAMBER_HEIGHT_MM;
  const panel = effectivePanelHeight(sb, chamber);
  const plan = planForSwitchboard({
    params: sb,
    verticals: withFeeders,
    overrides: overridesFromRows((oRows ?? []) as BusbarOverrideRow[]),
    densities: { Cu: Number(project?.busbar_density_cu ?? 1.6), Al: Number(project?.busbar_density_al ?? 1.0) },
    panelHeightMm: panel,
    chamberHeightMm: chamber,
  });
  const bom = artukEnclosureBom({
    verticals: withFeeders,
    plan,
    modularHeightMm: artukHeightOf(sb.panel_height_mm, chamber) - ARTUK_FIXED_MM,
    panelHeightMm: panel,
    chamberHeightMm: chamber,
    frontAccess: sb.cable_access === "Front",
    poles: sb.poles ?? 4,
    material: sb.busbar ?? "Cu",
    ka: sb.ka,
    internalArc: sb.internal_arc,
  });
  if (sb.arrangement === "double_front")
    bom.warnings.push("Double front: ABB's ICC parts for double-front (VC20xx-1DF) and the rear-side doors aren't listed automatically — add them below.");
  return priceEnclosure(supabase, bom, { GI: Number(project?.enclosure_rate_gi ?? 0), CRCA: Number(project?.enclosure_rate_crca ?? 0) });
}

// A part's rate: GI / CRCA parts with a weight = weight x the project's
// per-kg rate for that steel; anything else its Item Master net rate.
export async function priceEnclosure(
  supabase: SupabaseClient,
  bom: { lines: EnclosureLine[]; warnings: string[] },
  steel: SteelRates
): Promise<EnclosureTakeoff> {
  const codes = bom.lines.map((l) => l.code);
  const { data: items } = codes.length
    ? await supabase.from("item_master").select("sku, description, unit_cost, list_price, discount_pct, material, weight_kg").in("sku", codes)
    : { data: [] };
  type Row = {
    sku: string;
    description: string;
    unit_cost: number;
    list_price: number | null;
    discount_pct: number | null;
    material: string | null;
    weight_kg: number | null;
  };
  const bySku = new Map(((items ?? []) as Row[]).map((r) => [r.sku, r]));
  const lines = bom.lines
    .map((l) => {
      const item = bySku.get(l.code);
      const material = item?.material ?? null;
      const weightKg = item?.weight_kg != null ? Number(item.weight_kg) : null;
      const byWeight = (material === "GI" || material === "CRCA") && weightKg != null && weightKg > 0;
      const rate = !item
        ? 0
        : byWeight
          ? weightKg! * steel[material as keyof SteelRates]
          : effectiveNetRate({ unit_cost: Number(item.unit_cost), list_price: item.list_price, discount_pct: item.discount_pct });
      return {
        ...l,
        description: item?.description ?? "Not in Item Master",
        material,
        weightKg,
        rate,
        amount: rate * l.qty,
        inItemMaster: !!item,
        priced: rate > 0,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
    unpriced: lines.filter((l) => l.inItemMaster && !l.priced).length,
    missing: lines.filter((l) => !l.inItemMaster).length,
    warnings: bom.warnings,
  };
}
