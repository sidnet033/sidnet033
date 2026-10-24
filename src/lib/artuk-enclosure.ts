import type { SupabaseClient } from "@supabase/supabase-js";
import type { BayType, Feeder, PlacedFeeder, Switchboard, Vertical } from "@/types/database";
import { suggestAcbFrame } from "@/lib/artuk-sizing";
import { effectiveNetRate } from "@/lib/feeder-cost";
import { bayFunctionOf, breakerFrameOf, type BusbarPlan } from "@/lib/busbar-plan";
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
//  - main busbar supports by runs per phase (1-2R 551060-T6 x2, 3R
//    551090-T3 x3, 4R 551040-T1A INTL x3 + neutral support x3),
//  - ACB bays: ACB kit + segregation kit by frame and bay width, 4
//    segregation shelves, rear segregation 200x4 + 300x2 + 400x1, cross-
//    pieces TV1005-1 x4 and TV1211-1 (x2 on 920w and wider); bus couplers
//    add the internal bus riser parts,
//  - MCC bays: per MCCB a mounting kit + segregation kit by compartment
//    height; other devices a blind panel with cutout + back plate; 3
//    shelves, horizontal bus segregation, rear segregation 100 + 300,
//    crosspieces, and droppers' busbar supports,
//  - blank / DUMMY spaces and the busbar chamber: blind panel + back plate.
// Per line-up: one N°2 side-panel set (the deepest bay's depth), lifting
// eyebolts, and for every joint between bays a coupling kit (AD1014) and
// lifting reinforcement (SA1350-1).
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
};

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

  const main = input.plan?.segments.find((s) => s.kind === "main") ?? null;
  const runs = main?.runs ?? 1;
  const neutralRuns = main?.neutral?.runs ?? 0;

  let deepest: number[] = [];
  for (const bay of bays) {
    const w = bay.width_mm ?? 0;
    const name = bay.name;
    const prefix = WIDTH_PREFIX[w];
    const inner = innerWidth(w);
    const sections = depthSections(bay.depth_mm ?? 1037);
    if (sections.length > deepest.length || (sections[0] ?? 0) > (deepest[0] ?? 0)) deepest = sections;
    if (!prefix) {
      warnings.push(`${name}: ${w}mm isn't an ArTuK bay width (420/510/720/920/1120/1320) — its enclosure parts aren't listed.`);
      continue;
    }
    const alley = isAlley(bay.bay_type as BayType | null);

    // structure
    sections.forEach((d, i) => {
      add(`${prefix}${DEPTH_CODE[d]}-1`, 1, `${name}: top/base set ${w}x${d}`);
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
    add(
      inner === 1200 && H === "20" && !input.frontAccess ? "RF2012-2H" : `RF${H}${REAR_W[inner] ?? "60"}-1${input.frontAccess || inner === 1200 ? "" : "H"}`,
      1,
      `${name}: rear ${input.frontAccess ? "cover" : "door"}`
    );
    add("AD1090", 1, `${name}: internal door hinges`);

    // main busbar supports
    if ((bay.depth_mm ?? 1037) < 900) {
      add(runs >= 2 ? "MXM8224NS" : "MXM6514NS", 2, `${name}: busbar supports (${runs}R)`);
    } else if (runs <= 2) add("551060-T6", 2, `${name}: main busbar supports (${runs}R)`);
    else if (runs === 3) add("551090-T3", 3, `${name}: main busbar supports (3R)`);
    else {
      add("551040-T1A INTL", 3, `${name}: main busbar supports (${runs}R)`);
      if (input.poles >= 4) add(neutralRuns >= runs ? "551040-T1NFA" : "551040-T2NHA", 3, `${name}: neutral busbar supports`);
    }

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
      add("551060-T6", 4, `${name}: dropper busbar supports`);
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
    for (const d of deepest) add(`LF${H}${SIDE_D[d]}-1`, 1, `side panels (line-up ends, ${d}mm)`);
    add("AA9610-1", 1, "lifting eyebolts");
    add("SA1350-1", Math.max(0, bays.length - 1), "lifting reinforcement per joint between bays");
    add("AD1014", Math.max(0, bays.length - 1), "coupling kit per joint between bays");
  }

  return { lines: [...lines.values()], warnings };
}

export type EnclosureTakeoffLine = EnclosureLine & {
  description: string;
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

type ProjectSettings = { busbar_density_cu: number; busbar_density_al: number };

// Loads the GA and prices the ArTuK enclosure BOM from Item Master. Null
// when the switchboard isn't ArTuK.
export async function loadEnclosureTakeoff(supabase: SupabaseClient, sb: Switchboard): Promise<EnclosureTakeoff | null> {
  if (sb.std !== "ArTuK") return null;
  const [{ data: vRows }, { data: oRows }, { data: rev }] = await Promise.all([
    supabase.from("verticals").select("*").eq("switchboard_id", sb.id).order("sort_order"),
    supabase.from("busbar_overrides").select("*").eq("switchboard_id", sb.id),
    supabase.from("revisions").select("project:projects(busbar_density_cu, busbar_density_al)").eq("id", sb.revision_id).single(),
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
  });
  if (sb.arrangement === "double_front")
    bom.warnings.push("Double front: ABB's ICC parts for double-front (VC20xx-1DF) and the rear-side doors aren't listed automatically — add them below.");
  return priceEnclosure(supabase, bom);
}

export async function priceEnclosure(supabase: SupabaseClient, bom: { lines: EnclosureLine[]; warnings: string[] }): Promise<EnclosureTakeoff> {
  const codes = bom.lines.map((l) => l.code);
  const { data: items } = codes.length
    ? await supabase.from("item_master").select("sku, description, unit_cost, list_price, discount_pct").in("sku", codes)
    : { data: [] };
  type Row = { sku: string; description: string; unit_cost: number; list_price: number | null; discount_pct: number | null };
  const bySku = new Map(((items ?? []) as Row[]).map((r) => [r.sku, r]));
  const lines = bom.lines
    .map((l) => {
      const item = bySku.get(l.code);
      const rate = item ? effectiveNetRate({ unit_cost: Number(item.unit_cost), list_price: item.list_price, discount_pct: item.discount_pct }) : 0;
      return { ...l, description: item?.description ?? "Not in Item Master", rate, amount: rate * l.qty, inItemMaster: !!item, priced: rate > 0 };
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
