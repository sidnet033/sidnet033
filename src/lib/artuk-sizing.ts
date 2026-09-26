// Reference data ingested from ArTuK's standard feeder/bay sizing sheet
// (ArTuK_Copper_Busbar_Length_for_Emax_ACB_2.xlsx, "FEEDER SIZES" tab).
// This is a fixed engineering standard, not user-editable data -- both
// GA Builder's auto-generator (ga-canvas.tsx) and the read-only Dimensions
// Master page (dimensions-master.tsx) read from here, so they can never
// drift out of sync.
//
// DEFAULT POLICY -- resolves every place the source data offers more than
// one valid option, so the app never has to ask the user for a raw
// dimension, frame code, or panel-width/access standard:
//   1. Pure form-factor choices with no electrical consequence (a wider
//      vs narrower door/bay-width variant) default to the narrower one.
//   2. Choices with a real electrical/safety dimension (4P ACB neutral
//      rating) default to the more conservative (100% Ne) one.
//   3. Genuine either-way design choices with no signal anywhere in the
//      BOM (MCC front- vs rear-access) default to the unambiguous option
//      (rear access) and expose the alternative only as an explicit
//      manual GA Builder template.
// Any of these defaults can be overridden by hand afterward -- the
// generated bay's width_mm/depth_mm are ordinary editable fields.

import type { DeviceType } from "@/types/database";

export type AcbFrame = "E1.2" | "E2.2" | "E4.2" | "E6.2";
export type MccbFrame = "XT1/XT2" | "XT2" | "XT3/XT4" | "T5/XT5" | "T6/XT6" | "T7/XT7";
export type BayFunction = "incomer" | "outgoing" | "bus_coupler";

type AcbBracket = { uptoAmps: number; frame: AcbFrame; height: number; width3P: number; width4P50: number | null; width4P100: number };

// The device's own physical footprint (breaker face height/width) -- used
// only to suggest a frame from a rated current and as a fallback when no
// bay-spec row matches. ACB_BAY_SPECS below is authoritative for actual
// GA bay dimensions.
export const ACB_SIZES: AcbBracket[] = [
  { uptoAmps: 1250, frame: "E1.2", height: 600, width3P: 600, width4P50: null, width4P100: 600 },
  { uptoAmps: 2000, frame: "E2.2", height: 600, width3P: 600, width4P50: null, width4P100: 600 },
  { uptoAmps: 2500, frame: "E2.2", height: 600, width3P: 600, width4P50: 600, width4P100: 800 },
  { uptoAmps: 3200, frame: "E4.2", height: 600, width3P: 800, width4P50: null, width4P100: 800 },
  { uptoAmps: 4000, frame: "E6.2", height: 600, width3P: 1000, width4P50: 1000, width4P100: 1200 },
  { uptoAmps: Infinity, frame: "E6.2", height: 600, width3P: 1200, width4P50: 1200, width4P100: 1200 },
];

type MccbBracket = { uptoAmps: number; frame: MccbFrame; height: number; rearWidth: number };

export const MCCB_SIZES: MccbBracket[] = [
  { uptoAmps: 100, frame: "XT1/XT2", height: 200, rearWidth: 600 },
  { uptoAmps: 160, frame: "XT2", height: 300, rearWidth: 600 },
  { uptoAmps: 250, frame: "XT3/XT4", height: 400, rearWidth: 600 },
  { uptoAmps: 320, frame: "T5/XT5", height: 400, rearWidth: 600 },
  { uptoAmps: 400, frame: "T5/XT5", height: 500, rearWidth: 600 },
  { uptoAmps: 630, frame: "T6/XT6", height: 600, rearWidth: 600 },
  { uptoAmps: 1000, frame: "T7/XT7", height: 600, rearWidth: 600 },
];

// MCB isn't tabulated separately in the ArTuK sheet -- MCBs are always
// smaller than the smallest MCCB bracket in practice, so that bracket
// doubles as the MCB fallback.
const MCB_FALLBACK = MCCB_SIZES[0];

type MotorBracket = { uptoKw: number; height: number | null; standalone?: boolean };

// DOL and RDOL share one bracket shape in the source sheet.
export const DOL_RDOL_SIZES: MotorBracket[] = [
  { uptoKw: 11, height: 300 },
  { uptoKw: 22, height: 400 },
  { uptoKw: 30, height: 600 },
  { uptoKw: 45, height: 600 },
  { uptoKw: 90, height: 800, standalone: true },
  { uptoKw: Infinity, height: null },
];

export const STAR_DELTA_SIZES: MotorBracket[] = [
  { uptoKw: 11, height: 500 },
  { uptoKw: 22, height: 600 },
  { uptoKw: 30, height: 800 },
  { uptoKw: 45, height: 800 },
  { uptoKw: Infinity, height: null },
];

// VFD and Soft Starter share one table in the source sheet.
export const VFD_SOFT_STARTER_SIZES: MotorBracket[] = [
  { uptoKw: 22, height: 800 },
  { uptoKw: Infinity, height: null },
];

// ArTuK's standard single-width bay module (bay-spec row 67) -- the
// default bay every non-ACB "outgoing" feeder (MCCB/MCB/DOL/RDOL/
// Star-Delta/VFD/Soft Starter) packs into, regardless of that device's
// own smaller mounting footprint within the bay.
export const OUTGOING_MCC_BAY = { widthMm: 720, depthMm: 1037 };

export type AcbBaySpec = {
  frame: AcbFrame;
  function: BayFunction;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  ipRating: number;
  form: string;
  label: string;
  pairedWith?: { bayType: "cable_alley" | "outgoing"; widthMm: number; name?: string };
};

// The default (frame, function) -> bay dimensions used automatically by
// GA Builder's auto-generator. Exactly one entry per key.
export const ACB_BAY_SPECS: AcbBaySpec[] = [
  { frame: "E1.2", function: "incomer", widthMm: 720, heightMm: 2231, depthMm: 1037, ipRating: 54, form: "4b", label: "ArTu-K Emax 2 720w E1.2 Incomer/Outgoing" },
  { frame: "E1.2", function: "outgoing", widthMm: 720, heightMm: 2231, depthMm: 1037, ipRating: 54, form: "4b", label: "ArTu-K Emax 2 720w E1.2 Incomer/Outgoing" },
  { frame: "E2.2", function: "incomer", widthMm: 720, heightMm: 2231, depthMm: 1037, ipRating: 54, form: "4b", label: "ArTu-K Emax 2 720w E2.2 Incomer/Outgoing" },
  { frame: "E2.2", function: "outgoing", widthMm: 720, heightMm: 2231, depthMm: 1037, ipRating: 54, form: "4b", label: "ArTu-K Emax 2 720w E2.2 Incomer/Outgoing" },
  { frame: "E4.2", function: "incomer", widthMm: 920, heightMm: 2231, depthMm: 1037, ipRating: 42, form: "4b", label: "ArTu-K Emax 2 920w E4.2 Incomer/Outgoing" },
  { frame: "E4.2", function: "outgoing", widthMm: 920, heightMm: 2231, depthMm: 1037, ipRating: 42, form: "4b", label: "ArTu-K Emax 2 920w E4.2 Incomer/Outgoing" },
  {
    frame: "E6.2",
    function: "incomer",
    widthMm: 1120,
    heightMm: 2231,
    depthMm: 1467,
    ipRating: 42,
    form: "4b",
    label: "ArTu-K Emax 2 1120w E6.2 Incomer (1030+437mm deep)",
  },
  {
    frame: "E6.2",
    function: "outgoing",
    widthMm: 1120,
    heightMm: 2231,
    depthMm: 1467,
    ipRating: 42,
    form: "4b",
    label: "ArTu-K Emax 2 1120w E6.2 Outgoing (1030+437mm deep, no dedicated outgoing row in source -- reuses the incomer spec)",
  },
  {
    frame: "E1.2",
    function: "bus_coupler",
    widthMm: 920,
    heightMm: 2231,
    depthMm: 1037,
    ipRating: 54,
    form: "4b",
    label: "ArTu-K Emax 2 920w E1.2 Bus Coupler (Internal Bus Riser)",
  },
  {
    frame: "E2.2",
    function: "bus_coupler",
    widthMm: 920,
    heightMm: 2231,
    depthMm: 1037,
    ipRating: 54,
    form: "4b",
    label: "ArTu-K Emax 2 920+420w E2.2 Bus Coupler (External Cable Chamber)",
    pairedWith: { bayType: "cable_alley", widthMm: 420, name: "Cable Chamber" },
  },
];

// Wider/alternate variants the source sheet also lists, not chosen
// automatically per default policy #1 -- kept as data for the Dimensions
// Master page, and reachable by hand by widening the generated bay.
export const ACB_BAY_ALTERNATES: { frame: AcbFrame; function: BayFunction; widthMm: number; note: string }[] = [
  { frame: "E2.2", function: "incomer", widthMm: 920, note: "Wider variant of the 720w E2.2 bay -- same height/depth/IP/Form." },
  { frame: "E2.2", function: "outgoing", widthMm: 920, note: "Wider variant of the 720w E2.2 bay -- same height/depth/IP/Form." },
  { frame: "E6.2", function: "incomer", widthMm: 1320, note: "Wider variant of the 1120w E6.2 bay -- same height/depth/IP/Form." },
];

// Two-bay combo assembly for E1.2 outgoing ACBs -- more space-efficient
// than two separate single bays, so the auto-generator uses this whenever
// it has 2 or more E1.2 outgoing units to place. Also offered as a manual
// GA Builder template for standalone use.
export const ACB_2TIER_OUTGOING_E12 = {
  label: "ArTu-K 920+720w Emax 2 E1.2 2-Tier ACB Outgoing",
  primary: { widthMm: 920, depthMm: 1467 },
  paired: { widthMm: 720, depthMm: 1467 },
  heightMm: 2231,
  ipRating: 54,
  form: "4b",
  minUnits: 2,
};

// Front-access alternative to the default rear-access OUTGOING_MCC_BAY --
// a genuine either-way design choice (default policy #3), so it's never
// chosen automatically. Offered only as a manual GA Builder template.
export const MCC_FRONT_ACCESS_PAIR = {
  label: "ArTu-K 920+1120mm MCC Vertical, Front Access",
  primary: { widthMm: 920, depthMm: 637 },
  paired: { widthMm: 1120, depthMm: 637 },
  ipRating: 54,
  form: "4b",
  note: "Alternate to the default 720w rear-access MCC vertical used automatically by Auto-generate GA. Add this by hand if your board uses front access instead.",
};

export function suggestAcbFrame(ratedCurrentAmps: number): AcbFrame {
  const bracket = ACB_SIZES.find((b) => ratedCurrentAmps <= b.uptoAmps) ?? ACB_SIZES[ACB_SIZES.length - 1];
  return bracket.frame;
}

export function suggestMccbFrame(ratedCurrentAmps: number): MccbFrame {
  const bracket = MCCB_SIZES.find((b) => ratedCurrentAmps <= b.uptoAmps) ?? MCCB_SIZES[MCCB_SIZES.length - 1];
  return bracket.frame;
}

function motorBracketHeight(sizes: MotorBracket[], kw: number): number | null {
  return sizes.find((b) => kw <= b.uptoKw)?.height ?? null;
}

// A feeder's own stacking height inside a shared outgoing MCC bay, used by
// GA Builder's bin-packing. Returns null when there's no sizing bracket
// for this feeder yet (missing device_type/rating, or a rating band the
// source sheet doesn't give a height for at all, e.g. DOL above 90kW) --
// the feeder then simply isn't auto-placed, same as an unclassified
// feeder behaves today. ACB isn't handled here -- it's bay-dedicated, see
// lookupAcbBaySpec.
export function lookupFeederBoxHeight(feeder: {
  device_type: DeviceType | null;
  rated_current: number | null;
  rated_kw: number | null;
}): number | null {
  switch (feeder.device_type) {
    case "MCCB": {
      if (feeder.rated_current == null) return null;
      const bracket = MCCB_SIZES.find((b) => feeder.rated_current! <= b.uptoAmps) ?? MCCB_SIZES[MCCB_SIZES.length - 1];
      return bracket.height;
    }
    case "MCB":
      return MCB_FALLBACK.height;
    case "DOL":
    case "RDOL":
      return feeder.rated_kw == null ? null : motorBracketHeight(DOL_RDOL_SIZES, feeder.rated_kw);
    case "STAR_DELTA":
      return feeder.rated_kw == null ? null : motorBracketHeight(STAR_DELTA_SIZES, feeder.rated_kw);
    case "VFD":
    case "SOFT_STARTER":
      return feeder.rated_kw == null ? null : motorBracketHeight(VFD_SOFT_STARTER_SIZES, feeder.rated_kw);
    default:
      return null;
  }
}

export function lookupAcbBaySpec(frame: AcbFrame, fn: BayFunction): AcbBaySpec | undefined {
  return ACB_BAY_SPECS.find((s) => s.frame === frame && s.function === fn);
}

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  ACB: "ACB (Emax2)",
  MCCB: "MCCB",
  MCB: "MCB",
  DOL: "DOL/RDOL",
  RDOL: "DOL/RDOL",
  STAR_DELTA: "Star-Delta",
  VFD: "VFD",
  SOFT_STARTER: "Soft Starter",
  OTHER: "Other",
};

export const MOTOR_STARTER_TYPES: DeviceType[] = ["DOL", "RDOL", "STAR_DELTA", "VFD", "SOFT_STARTER"];
