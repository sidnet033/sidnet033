import { bayFunctionOf, breakerFrameOf } from "@/lib/busbar-plan";
import {
  suggestAcbFrame,
  type AcbFrame,
  type BayFunction,
} from "@/lib/artuk-sizing";
import type { BayType, Feeder } from "@/types/database";

// ABB's standard ArTu-K vertical configurations, from "ArTu-K Assembly
// Guideline and Standard Compartment Sizes" (Doc ELSP/ARTUK/ENGG/WEL KIT,
// 20230617-WK-003, Rev R3, 25-Mar-2023), pages 1-11. Each has the sheet's
// own front + sectional side view (public/artuk-bays/bay-NN.jpg) and the
// full sheet with its parts list (sheet-NN.jpg). All are 2231mm high
// (2131 + 100 base frame).
export type ArtukBayConfig = {
  id: string;
  page: number;
  label: string; // exactly as titled on the ABB sheet
  kind: "acb" | "mcc";
  frame: AcbFrame | null; // ACB frame the bay is built for
  functions: BayFunction[]; // what the ACB in it may be
  access: "rear" | "front";
  /** the bay itself */
  widthMm: number;
  depthMm: number;
  /** depth as ABB writes it, e.g. "1030+437" */
  depthNote?: string;
  ip: number;
  form: string;
  /** a second bay that goes right next to it (cable chamber, 2nd tier...) */
  partner?: { widthMm: number; bayType: BayType; name: string };
  note?: string;
};

export const ARTUK_HEIGHT_MM = 2231;

export const ARTUK_BAY_CONFIGS: ArtukBayConfig[] = [
  {
    id: "e12-720-io",
    page: 1,
    label: "ArTu-K Emax 2 720w E1.2 WITHDRAW ACB Incomer / Outgoing",
    kind: "acb",
    frame: "E1.2",
    functions: ["incomer", "outgoing"],
    access: "rear",
    widthMm: 720,
    depthMm: 1037,
    ip: 54,
    form: "4B",
  },
  {
    id: "e22-720-io",
    page: 2,
    label: "ArTu-K Emax 2 720w E2.2 WITHDRAW ACB Incomer / Outgoing",
    kind: "acb",
    frame: "E2.2",
    functions: ["incomer", "outgoing"],
    access: "rear",
    widthMm: 720,
    depthMm: 1037,
    ip: 54,
    form: "4B",
  },
  {
    id: "e22-920-io",
    page: 3,
    label: "ArTu-K Emax 2 920w E2.2 WITHDRAW ACB Incomer / Outgoing",
    kind: "acb",
    frame: "E2.2",
    functions: ["incomer", "outgoing"],
    access: "rear",
    widthMm: 920,
    depthMm: 1037,
    ip: 54,
    form: "4B",
    note: "Wider E2.2 bay (800mm compartment) — for 4P 100% neutral / 2500A.",
  },
  {
    id: "e42-920-io",
    page: 4,
    label: "ArTu-K Emax 2 920w E4.2 WITHDRAW ACB Incomer / Outgoing",
    kind: "acb",
    frame: "E4.2",
    functions: ["incomer", "outgoing"],
    access: "rear",
    widthMm: 920,
    depthMm: 1037,
    ip: 42,
    form: "4B",
  },
  {
    id: "e12-920-bc",
    page: 5,
    label: "ArTu-K Emax 2 920w E1.2 WITHDRAW ACB BC With Internal Bus Riser",
    kind: "acb",
    frame: "E1.2",
    functions: ["bus_coupler"],
    access: "rear",
    widthMm: 920,
    depthMm: 1037,
    ip: 54,
    form: "4B",
  },
  {
    id: "e22-920-420-bc",
    page: 6,
    label: "ArTu-K Emax 2 920+420 E2.2 w ACB BC With External Cable Chamber",
    kind: "acb",
    frame: "E2.2",
    functions: ["bus_coupler"],
    access: "rear",
    widthMm: 920,
    depthMm: 1037,
    ip: 54,
    form: "4B",
    partner: { widthMm: 420, bayType: "cable_alley", name: "Cable Chamber" },
  },
  {
    id: "e62-1120-in",
    page: 7,
    label: "ArTu-K Emax 2 1120w E6.2 WITHDRAW ACB INCOMER",
    kind: "acb",
    frame: "E6.2",
    functions: ["incomer"],
    access: "rear",
    widthMm: 1120,
    depthMm: 1467,
    depthNote: "1030+437",
    ip: 42,
    form: "4B",
    note: "3P with 50% neutral.",
  },
  {
    id: "e62-1320-in",
    page: 8,
    label: "ArTu-K Emax 2 1320w E6.2 WITHDRAW ACB INCOMER",
    kind: "acb",
    frame: "E6.2",
    functions: ["incomer"],
    access: "rear",
    widthMm: 1320,
    depthMm: 1467,
    depthNote: "1030+437",
    ip: 42,
    form: "4B",
    note: "4P (full neutral).",
  },
  {
    id: "mcc-920-1120-fa",
    page: 9,
    label: "ArTu-K 920+1120mm MCC VERTICAL FRONT ACCESS",
    kind: "mcc",
    frame: null,
    functions: ["incomer", "outgoing"],
    access: "front",
    widthMm: 920,
    depthMm: 637,
    ip: 54,
    form: "3B",
    partner: {
      widthMm: 1120,
      bayType: "outgoing",
      name: "MCC Front Access (2)",
    },
    note: "637mm deep for a single-run busbar (837mm for two runs).",
  },
  {
    id: "mcc-720-ra",
    page: 10,
    label: "ArTu-K 720mm WIDTH MCC VERTICAL REAR ACCESS",
    kind: "mcc",
    frame: null,
    functions: ["incomer", "outgoing"],
    access: "rear",
    widthMm: 720,
    depthMm: 1037,
    ip: 54,
    form: "4B",
  },
  {
    id: "e12-920-720-2t",
    page: 11,
    label: "ArTu-K 920+720mm Emax 2 E1.2 2 Tier ACB Outgoing",
    kind: "acb",
    frame: "E1.2",
    functions: ["outgoing"],
    access: "rear",
    widthMm: 920,
    depthMm: 1467,
    depthNote: "1030+437",
    ip: 54,
    form: "4B",
    partner: {
      widthMm: 720,
      bayType: "outgoing",
      name: "Outgoing (E1.2 2-Tier, 2)",
    },
    note: "Two E1.2 ACBs stacked per bay, 4 ACBs across the pair.",
  },
];

export const bayImage = (c: ArtukBayConfig) =>
  `/artuk-bays/bay-${String(c.page).padStart(2, "0")}.jpg`;
export const sheetImage = (c: ArtukBayConfig) =>
  `/artuk-bays/sheet-${String(c.page).padStart(2, "0")}.jpg`;

type BayLike = {
  bay_type: BayType | null;
  width_mm: number | null;
  depth_mm: number | null;
  placed: { qty: number; feeder: Feeder }[];
};

function acbFrameOf(f: Feeder): AcbFrame | null {
  const fr = breakerFrameOf(f);
  if (fr && ["E1.2", "E2.2", "E4.2", "E6.2"].includes(fr))
    return fr as AcbFrame;
  return f.rated_current != null
    ? suggestAcbFrame(Number(f.rated_current))
    : null;
}

const FN_LABEL: Record<BayFunction, string> = {
  incomer: "incomer",
  outgoing: "outgoing",
  bus_coupler: "bus coupler",
};

/** reasons this config may not suit what's placed in the bay (empty = fits) */
export function configMisfits(
  c: ArtukBayConfig,
  bay: BayLike,
  cableAccess: "Front" | "Rear" | null | undefined,
): string[] {
  const out: string[] = [];
  const acbs = bay.placed.filter((p) => p.feeder.device_type === "ACB");
  const acbUnits = acbs.reduce((n, p) => n + p.qty, 0);
  const others = bay.placed.filter(
    (p) =>
      p.feeder.device_type &&
      p.feeder.device_type !== "ACB" &&
      p.feeder.device_type !== "OTHER",
  );
  if (c.kind === "acb") {
    if (acbUnits === 0)
      out.push(
        others.length
          ? "This bay holds MCCB / motor feeders, not an ACB."
          : "No ACB is placed in this bay yet.",
      );
    const frames = [
      ...new Set(
        acbs.map((p) => acbFrameOf(p.feeder)).filter((f): f is AcbFrame => !!f),
      ),
    ];
    const wrong = frames.filter((f) => f !== c.frame);
    if (wrong.length)
      out.push(
        `The bay's ACB is ${wrong.join(", ")}; this config is for ${c.frame}.`,
      );
    const fns = [
      ...new Set(
        acbs
          .map((p) => bayFunctionOf(p.feeder))
          .filter((f): f is BayFunction => !!f),
      ),
    ];
    const badFn = fns.filter((f) => !c.functions.includes(f));
    if (badFn.length)
      out.push(
        `The bay's ACB is a${badFn[0] === "incomer" || badFn[0] === "outgoing" ? "n" : ""} ${badFn.map((f) => FN_LABEL[f]).join(" / ")}; this config is for ${c.functions.map((f) => FN_LABEL[f]).join(" / ")}.`,
      );
    const perBay = c.id === "e12-920-720-2t" ? 2 : 1;
    if (acbUnits > perBay)
      out.push(
        `${acbUnits} ACBs are in this bay; this config takes ${perBay}.`,
      );
    if (others.length && acbUnits > 0)
      out.push("The bay also holds MCCB / motor feeders.");
  } else {
    if (acbUnits > 0)
      out.push("This bay holds an ACB; this is an MCC (MCCB) vertical.");
  }
  if (c.access === "front" && cableAccess !== "Front")
    out.push(
      "This is a front-access vertical; the switchboard is set to rear access.",
    );
  if (c.access === "rear" && c.kind === "mcc" && cableAccess === "Front")
    out.push(
      "This is a rear-access vertical; the switchboard is set to front access.",
    );
  return out;
}

/** the config this bay (and its right-hand neighbour) currently looks like, if any */
export function currentConfigOf(
  bay: BayLike,
  rightNeighbour: BayLike | null,
): ArtukBayConfig | null {
  const acb = bay.placed.find((p) => p.feeder.device_type === "ACB");
  const frame = acb ? acbFrameOf(acb.feeder) : null;
  const candidates = ARTUK_BAY_CONFIGS.filter(
    (c) =>
      c.widthMm === bay.width_mm &&
      c.depthMm === bay.depth_mm &&
      (!c.partner ||
        (rightNeighbour &&
          rightNeighbour.width_mm === c.partner.widthMm &&
          rightNeighbour.bay_type === c.partner.bayType)),
  );
  return (
    candidates.find(
      (c) =>
        c.kind === "acb" &&
        c.frame === frame &&
        configMisfits(c, bay, "Rear").length === 0,
    ) ??
    candidates.find((c) =>
      acb ? c.kind === "acb" && c.frame === frame : c.kind === "mcc",
    ) ??
    null
  );
}
