import type { BarSize, BusbarMaterial } from "@/lib/busbar-plan";

// ABB's ArTuK busbar charts. On ArTuK boards the main busbar and each
// breaker's links come from these charts -- not from current density.
// Sources:
//  - "ArTuK Copper Busbar Length for Emax ACB" workbook (copper, Emax 2
//    ACB): sizes plus ABB's cut length for every piece. These are the
//    primary copper ACB charts.
//  - "ArTu-K Busbar Chart" ELSP/ARTU-K/ENGG/BUSBAR CHART/01 R4 (Aug 2023):
//    aluminium Emax 2 ACB, aluminium and copper Tmax/XT MCCB link sizes,
//    aluminium main busbar for MCCB-only boards, and one copper ACB row the
//    workbook doesn't have (2500A E4.2 Vr-Vr IP54). New Emax pages ignored.
//
// Copper charts are 100% neutral (even if the board spec says 50%); the
// 5000A copper chart has fewer neutral runs, as ABB draws it. Aluminium
// charts give their own (smaller) neutral. The HBB position is ignored.
//
// Each ACB chart gives:
//  - the bay width ABB designed it for,
//  - the main busbar size,
//  - the "Main busbar to ACB link (Top)" -- the riser / ACB link between the
//    main busbar and the ACB; where it has two joints, the first joint is at
//    the ACB terminal (top link) and the second runs on to the main busbar
//    (dropper),
//  - the "ACB link (Bottom)" / "ACB out-going link" -- the bar on the ACB's
//    other terminal, where the cables land (cable link), as one or two joints,
//  - the earth busbar size (PDF charts),
//  - copper workbook only: ABB's cut lengths per bar size for each side (all
//    phases + neutral, every run). Weight and BOM use these directly; other
//    charts use the drawn length, with the first joint taken as the first
//    FIRST_JOINT_MM at the breaker terminal and the second joint the rest.

// ABB's top links (first joint) are 300-315mm in every workbook sheet
export const FIRST_JOINT_MM = 310;

// phMaterial: when ABB specifies phase bars in another material than the
// board's (the 5000A aluminium chart uses copper phase links)
export type ChartJoint = { bar: BarSize; runs: number; neRuns: number; phMaterial?: BusbarMaterial };

export type ArtukChart = {
  material: BusbarMaterial;
  sheet: string;
  frames: string[];
  maxA: number;
  ratingLabel: string;
  bayWidthMm: number;
  bayDepthLabel: string;
  scKa: number;
  terminals: string;
  ip: number;
  main: ChartJoint;
  // first joint (at the ACB terminal) first
  top: ChartJoint[];
  bottom: ChartJoint[];
  // total bar length per size (mm), all phases + neutral, every run --
  // copper workbook charts only
  topPieces?: { bar: BarSize; lengthMm: number }[];
  bottomPieces?: { bar: BarSize; lengthMm: number }[];
  earth?: { bar: BarSize; runs: number };
  // the chart only applies to this pole count (4000A Al 1120w is 3P only)
  poles?: 3 | 4;
};


const b = (widthMm: number): BarSize => ({ widthMm, thicknessMm: 10 });
const j = (runs: number, widthMm: number, neRuns = runs): ChartJoint => ({ bar: b(widthMm), runs, neRuns });
const p = (widthMm: number, lengthMm: number) => ({ bar: b(widthMm), lengthMm });

// Copper workbook, smallest rating first.
export const ARTUK_CU_CHARTS: ArtukChart[] = [
  {
    material: "Cu",
    sheet: "E1.2 800A-1000A Vr-Vr 4P",
    frames: ["E1.2"],
    maxA: 1000,
    ratingLabel: "800A–1000A",
    bayWidthMm: 720,
    bayDepthLabel: "1030",
    scKa: 50,
    terminals: "Vr-Vr",
    ip: 54,
    main: j(1, 80),
    top: [j(2, 50)],
    bottom: [j(2, 50)],
    topPieces: [p(50, 10578)],
    bottomPieces: [p(50, 5129)],
  },
  {
    material: "Cu",
    sheet: "E1.2E2.2 1250A Vr-Vr 4P",
    frames: ["E1.2", "E2.2"],
    maxA: 1250,
    ratingLabel: "1250A",
    bayWidthMm: 720,
    bayDepthLabel: "1030",
    scKa: 50,
    terminals: "Vr-Vr",
    ip: 54,
    main: j(1, 80),
    top: [j(2, 80), j(1, 80)],
    bottom: [j(2, 80)],
    topPieces: [p(80, 6838)],
    bottomPieces: [p(80, 5129)],
  },
  {
    material: "Cu",
    sheet: "E2.2 1600A Vr-Vr 4P",
    frames: ["E2.2"],
    maxA: 1600,
    ratingLabel: "1600A",
    bayWidthMm: 720,
    bayDepthLabel: "1030",
    scKa: 50,
    terminals: "Vr-Vr",
    ip: 54,
    main: j(2, 60),
    top: [j(2, 80), j(2, 60)],
    bottom: [j(2, 80)],
    topPieces: [p(80, 2458), p(60, 8920)],
    bottomPieces: [p(80, 5129)],
  },
  {
    material: "Cu",
    sheet: "E2.2 2000A Vr-Vr 4P",
    frames: ["E2.2"],
    maxA: 2000,
    ratingLabel: "2000A",
    bayWidthMm: 720,
    bayDepthLabel: "1030",
    scKa: 50,
    terminals: "Vr-Vr",
    ip: 54,
    main: j(2, 100),
    top: [j(2, 100), j(2, 80)],
    bottom: [j(2, 100)],
    topPieces: [p(100, 2458), p(80, 8920)],
    bottomPieces: [p(100, 5129)],
  },
  {
    material: "Cu",
    sheet: "E2.2 2500A SVr-SVr 4P",
    frames: ["E2.2"],
    maxA: 2500,
    ratingLabel: "2500A",
    bayWidthMm: 920,
    bayDepthLabel: "1030",
    scKa: 65,
    terminals: "SVr-SVr",
    ip: 43,
    main: j(2, 80),
    top: [j(2, 100), j(2, 80)],
    bottom: [j(3, 100)],
    topPieces: [p(100, 2458), p(80, 8920)],
    bottomPieces: [p(100, 5994)],
  },
  {
    material: "Cu",
    sheet: "E4.2 3200A Vr-Vr 4P",
    frames: ["E4.2"],
    maxA: 3200,
    ratingLabel: "3200A",
    bayWidthMm: 920,
    bayDepthLabel: "1030",
    scKa: 65,
    terminals: "SVr-SVr",
    ip: 54,
    main: j(2, 120),
    top: [j(3, 120), j(3, 100)],
    bottom: [j(3, 120), j(3, 100)],
    topPieces: [p(120, 3705), p(100, 13140)],
    bottomPieces: [p(120, 3690), p(100, 6240)],
  },
  {
    material: "Cu",
    sheet: "E6.2 4000A Vr-Vr 4P",
    frames: ["E6.2"],
    maxA: 4000,
    ratingLabel: "4000A",
    bayWidthMm: 1320,
    bayDepthLabel: "1030",
    scKa: 65,
    terminals: "Vr-Vr",
    ip: 54,
    main: j(3, 120),
    top: [j(6, 120), j(4, 120)],
    bottom: [j(6, 120), j(3, 120)],
    topPieces: [p(120, 39204)],
    bottomPieces: [p(120, 11400)],
  },
  {
    // ABB's own total on this sheet (48166mm) leaves out the last 450mm
    // bottom-link piece; the piece list (15 bars for 4R Ph + 3R Ne) is used.
    material: "Cu",
    sheet: "E6.2 5000A Vr-Vr 4P",
    frames: ["E6.2"],
    maxA: 5000,
    ratingLabel: "5000A",
    bayWidthMm: 1320,
    bayDepthLabel: "1030+437",
    scKa: 87,
    terminals: "Vr-Vr",
    ip: 54,
    main: j(3, 160),
    top: [j(6, 160, 4), j(4, 160, 3)],
    bottom: [j(6, 160, 4), j(4, 160, 3)],
    topPieces: [p(160, 36366)],
    bottomPieces: [p(160, 12250)],
  },
];

// Earth busbar per copper chart, from the PDF chart (added alongside the
// workbook's sizes, which are unchanged).
const CU_EARTH: Record<string, [number, number]> = {
  "E1.2 800A-1000A Vr-Vr 4P": [1, 40],
  "E1.2E2.2 1250A Vr-Vr 4P": [1, 40],
  "E2.2 1600A Vr-Vr 4P": [1, 60],
  "E2.2 2000A Vr-Vr 4P": [1, 60],
  "E2.2 2500A SVr-SVr 4P": [1, 80],
  "E4.2 3200A Vr-Vr 4P": [2, 60],
  "E6.2 4000A Vr-Vr 4P": [2, 100],
  "E6.2 5000A Vr-Vr 4P": [2, 120],
};
for (const c of ARTUK_CU_CHARTS) {
  const e = CU_EARTH[c.sheet];
  if (e) c.earth = { bar: b(e[1]), runs: e[0] };
}

// Copper rows from the PDF chart that the workbook doesn't have. No cut
// lengths, so their weight comes from the drawn bar lengths.
export const ARTUK_CU_PDF_CHARTS: ArtukChart[] = [
  {
    material: "Cu",
    sheet: "PDF Cu 2500A E4.2 Vr-Vr",
    frames: ["E4.2"],
    maxA: 2500,
    ratingLabel: "2500A (E4.2)",
    bayWidthMm: 920,
    bayDepthLabel: "—",
    scKa: 65,
    terminals: "Vr-Vr",
    ip: 54,
    main: j(2, 100),
    top: [j(4, 100), j(2, 100)],
    bottom: [j(4, 100), j(3, 100)],
    earth: { bar: b(80), runs: 1 },
  },
];

const al = (
  sheet: string,
  frames: string[],
  maxA: number,
  ratingLabel: string,
  bayWidthMm: number,
  scKa: number,
  terminals: string,
  ip: number,
  main: ChartJoint,
  bottom: ChartJoint[],
  top: ChartJoint[],
  earth: [number, number],
  poles?: 3 | 4
): ArtukChart => ({
  material: "Al",
  sheet,
  frames,
  maxA,
  ratingLabel,
  bayWidthMm,
  bayDepthLabel: "—",
  scKa,
  terminals,
  ip,
  main,
  top,
  bottom,
  earth: { bar: b(earth[1]), runs: earth[0] },
  poles,
});

// Aluminium, Emax 2 ACB (PDF pages 2-3), smallest rating first. Argument
// order: main, ACB out-going link (bottom), main busbar to ACB link (top).
export const ARTUK_AL_ACB_CHARTS: ArtukChart[] = [
  al("PDF Al 800A E1.2", ["E1.2"], 800, "800A", 720, 50, "Hr-Vr", 54, j(2, 60, 1), [j(2, 60, 1)], [j(2, 50, 1)], [1, 50]),
  al("PDF Al 1000A E1.2", ["E1.2"], 1000, "1000A", 720, 50, "Vr-Vr", 54, j(2, 80, 1), [j(2, 80, 1)], [j(2, 80, 2), j(3, 60, 2)], [1, 50]),
  al("PDF Al 1250A E1.2", ["E1.2"], 1250, "1250A (E1.2)", 720, 50, "Vr-Vr", 54, j(2, 100, 1), [j(2, 100, 1)], [j(2, 100, 1)], [1, 60]),
  al("PDF Al 1250A E2.2 IP54", ["E2.2"], 1250, "1250A (E2.2, IP54)", 720, 50, "Vr-Vr", 54, j(2, 100, 1), [j(3, 60, 2)], [j(3, 60, 2)], [1, 60]),
  al("PDF Al 1250A E2.2 IP42", ["E2.2"], 1250, "1250A (E2.2, IP42)", 720, 50, "Vr-Vr", 42, j(2, 80, 1), [j(2, 80, 1)], [j(3, 60, 2)], [1, 60]),
  al("PDF Al 1600A E2.2", ["E2.2"], 1600, "1600A", 720, 50, "Vr-Vr", 54, j(2, 125, 1), [j(2, 125, 1)], [j(3, 80, 2), j(4, 60, 2)], [1, 60]),
  al("PDF Al 2000A E2.2", ["E2.2"], 2000, "2000A", 720, 50, "Vr-Vr", 42, j(2, 125, 1), [j(3, 100, 2)], [j(3, 80, 2), j(4, 60, 2)], [1, 80]),
  al("PDF Al 2500A E2.2 720w", ["E2.2"], 2500, "2500A (720w)", 720, 50, "SVr-SVr", 42, j(3, 125, 2), [j(3, 125, 2)], [j(3, 125, 2), j(4, 100, 2)], [1, 100]),
  al("PDF Al 2500A E2.2 920w", ["E2.2"], 2500, "2500A (920w)", 920, 50, "SVr-SVr", 42, j(3, 125, 2), [j(4, 100, 2)], [j(4, 100, 2)], [1, 100]),
  al("PDF Al 3200A E4.2", ["E4.2"], 3200, "3200A", 920, 65, "Vr-Vr", 42, j(3, 160, 2), [j(4, 125, 2)], [j(4, 125, 2)], [1, 125]),
  al("PDF Al 4000A E6.2 3P", ["E6.2"], 4000, "4000A (1120w, 3P)", 1120, 50, "Vr-Vr", 42, j(4, 150, 2), [j(4, 150, 2)], [j(4, 150, 2)], [1, 150], 3),
  al("PDF Al 4000A E6.2", ["E6.2"], 4000, "4000A (1320w)", 1320, 50, "Vr-Vr", 42, j(4, 150, 4), [j(4, 150, 4)], [j(4, 150, 4)], [1, 150]),
  // ABB specifies copper phase links (6R 100×10 Cu) with aluminium neutral here
  al(
    "PDF Al 5000A E6.2",
    ["E6.2"],
    5000,
    "5000A",
    1320,
    65,
    "Vr-Vr",
    42,
    j(4, 200, 2),
    [{ ...j(6, 100, 4), phMaterial: "Cu" }],
    [{ ...j(6, 100, 4), phMaterial: "Cu" }],
    [1, 200]
  ),
];

// Tmax/XT MCCB: busbar link size at the MCCB terminal (the feeder link from
// the dropper). ABB gives the phase size; neutral is taken the same (100%).
export type MccbLinkRow = { frame: string; maxA: number; ratingLabel: string; link: ChartJoint; terminal: string };
const ml = (frame: string, maxA: number, ratingLabel: string, runs: number, w: number, t: number, terminal = "Rear"): MccbLinkRow => ({
  frame,
  maxA,
  ratingLabel,
  link: { bar: { widthMm: w, thicknessMm: t }, runs, neRuns: runs },
  terminal,
});

export const ARTUK_MCCB_LINKS: Record<BusbarMaterial, MccbLinkRow[]> = {
  Cu: [
    ml("XT1", 100, "Upto 100A", 1, 15, 5),
    ml("XT2", 125, "125A", 1, 15, 5),
    ml("XT2", 160, "160A", 1, 15, 5),
    ml("XT3", 160, "160A", 1, 20, 10),
    ml("XT4", 200, "200A", 1, 20, 10),
    ml("XT4", 250, "250A", 1, 20, 10),
    ml("T5/XT5", 400, "320A/400A", 1, 30, 10),
    ml("T5/XT5", 630, "630A", 2, 30, 10),
    ml("T6/XT6", 630, "630A", 1, 50, 10),
    ml("T6/XT6", 800, "800A", 1, 50, 10),
    ml("T7/XT7", 800, "800A", 1, 50, 10, "HR/VR"),
    ml("T7/XT7", 1000, "1000A", 2, 50, 10, "HR/VR"),
    ml("T7/XT7", 1250, "1250A", 2, 50, 10, "HR/VR"),
  ],
  Al: [
    ml("XT1", 100, "Upto 100A", 1, 20, 10),
    ml("XT2", 160, "160A", 1, 20, 10),
    ml("XT3", 200, "200A", 1, 25, 10),
    ml("XT4", 250, "250A", 2, 30, 6),
    ml("T5/XT5", 400, "320A/400A", 2, 40, 10),
    ml("T6/XT6", 630, "630A", 2, 40, 10),
    ml("T7/XT7", 800, "800A", 2, 50, 10, "HR/VR"),
  ],
};

// Aluminium main busbar (HBB) for lower-rated boards fed by an MCCB (no
// ACB incomer). ABB gives the phase size; neutral is taken the same.
export type MccbHbbRow = { maxA: number; ratingLabel: string; frame: string; scKa: number; kaLabel: string; main: ChartJoint; earth: { bar: BarSize; runs: number } };
export const ARTUK_AL_MCCB_HBB: MccbHbbRow[] = [
  { maxA: 160, ratingLabel: "Upto 160A", frame: "XT2", scKa: 36, kaLabel: "25/36kA", main: j(1, 40), earth: { bar: b(40), runs: 1 } },
  { maxA: 250, ratingLabel: "200/250A", frame: "XT4", scKa: 36, kaLabel: "25/36kA", main: j(1, 50), earth: { bar: b(40), runs: 1 } },
  { maxA: 400, ratingLabel: "400A", frame: "T5/XT5", scKa: 36, kaLabel: "25/36kA", main: j(1, 50), earth: { bar: b(40), runs: 1 } },
  { maxA: 630, ratingLabel: "630A", frame: "T6/XT6", scKa: 50, kaLabel: "36/50kA", main: j(2, 50), earth: { bar: b(50), runs: 1 } },
  { maxA: 800, ratingLabel: "800A", frame: "T7/XT7", scKa: 50, kaLabel: "36/50kA", main: j(2, 50), earth: { bar: b(50), runs: 1 } },
];


export function parseIp(ip: string | null | undefined): number | null {
  const m = (ip ?? "").match(/(\d{2})/);
  return m ? Number(m[1]) : null;
}

export type ChartPick = { chart: ArtukChart; warnings: string[] } | null;

export function acbChartsFor(material: BusbarMaterial): ArtukChart[] {
  return material === "Cu" ? [...ARTUK_CU_CHARTS, ...ARTUK_CU_PDF_CHARTS].sort((x, y) => x.maxA - y.maxA) : ARTUK_AL_ACB_CHARTS;
}

// The ABB chart for an ACB: the smallest rating that covers the ACB and
// whose short-circuit and IP ratings cover the board's (a chart rated
// higher is fine). Between charts of the same rating, the one drawn for
// the bay's width wins, else the first listed (the copper workbook before
// the PDF). If the board's kA / IP is beyond every chart covering the
// rating, the nearest chart is used with a warning.
export function pickArtukChart(args: {
  material: BusbarMaterial;
  amps: number | null;
  ka: number | null;
  ip: number | null;
  poles?: number | null;
  bayWidthMm?: number | null;
}): ChartPick {
  const { material, amps, ka, ip } = args;
  if (amps == null || amps <= 0) return null;
  const pool = acbChartsFor(material).filter((c) => !c.poles || args.poles == null || c.poles === args.poles);
  const byRating = pool.filter((c) => c.maxA >= amps);
  if (byRating.length === 0) {
    const top = pool[pool.length - 1];
    return { chart: top, warnings: [`${amps}A is above ABB's largest ArTuK ${material} chart (${top.ratingLabel}) — that chart used; check with ABB.`] };
  }
  const fits = (c: ArtukChart) => (ka == null || c.scKa >= ka) && (ip == null || c.ip >= ip);
  const best = (list: ArtukChart[]) => {
    const atRating = list.filter((c) => c.maxA === list[0].maxA);
    return atRating.find((c) => args.bayWidthMm != null && c.bayWidthMm === args.bayWidthMm) ?? atRating[0];
  };
  const fitting = byRating.filter(fits);
  if (fitting.length) {
    const chart = best(fitting);
    const nominal = byRating[0];
    const warnings =
      chart.maxA === nominal.maxA
        ? []
        : [
            `${amps}A: ABB's ${nominal.ratingLabel} ${material} chart only covers ${nominal.scKa}kA / IP${nominal.ip}, so the next chart that covers the board's ${ka != null ? `${ka}kA` : ""}${ka != null && ip != null ? " / " : ""}${ip != null ? `IP${ip}` : ""} (${chart.ratingLabel}) is used — confirm with ABB.`,
          ];
    return { chart, warnings };
  }
  const nearest = best(byRating);
  const warnings: string[] = [];
  if (ka != null && nearest.scKa < ka) warnings.push(`Board is ${ka}kA but ABB's ${nearest.ratingLabel} ${material} chart is for ${nearest.scKa}kA — check with ABB.`);
  if (ip != null && nearest.ip < ip) warnings.push(`Board is IP${ip} but ABB's ${nearest.ratingLabel} ${material} chart is for IP${nearest.ip} — check with ABB.`);
  return { chart: nearest, warnings };
}

const frameTokens = (f: string) => f.toUpperCase().split("/").map((t) => t.trim());

// MCCB link size by rating, matching the frame ArTuK sizing would pick for
// that rating (e.g. 630A -> T6/XT6, not T5/XT5).
export function pickMccbLink(material: BusbarMaterial, amps: number | null, frame: string | null): { row: MccbLinkRow; warnings: string[] } | null {
  if (amps == null || amps <= 0) return null;
  const rows = ARTUK_MCCB_LINKS[material];
  const wanted = frame ? frameTokens(frame) : [];
  const covering = rows.filter((r) => r.maxA >= amps);
  if (covering.length === 0) {
    const top = rows[rows.length - 1];
    return { row: top, warnings: [`${amps}A MCCB is above ABB's ${material} MCCB link chart (${top.ratingLabel}) — ${top.frame} size used; check with ABB.`] };
  }
  const row = covering.find((r) => frameTokens(r.frame).some((t) => wanted.includes(t))) ?? covering[0];
  return { row, warnings: [] };
}

// Aluminium main busbar for an MCCB-fed board.
export function pickAlMccbHbb(amps: number | null, ka: number | null): { row: MccbHbbRow; warnings: string[] } | null {
  if (amps == null || amps <= 0) return null;
  const covering = ARTUK_AL_MCCB_HBB.filter((r) => r.maxA >= amps);
  if (covering.length === 0) return null;
  const row = covering.find((r) => ka == null || r.scKa >= ka);
  if (row) return { row, warnings: row === covering[0] ? [] : [`Board is ${ka}kA — ABB's ${covering[0].ratingLabel} HBB row only covers ${covering[0].kaLabel}, so the ${row.ratingLabel} size is used.`] };
  return { row: covering[covering.length - 1], warnings: [`Board is ${ka}kA but ABB's MCCB HBB chart only goes to 50kA — check with ABB.`] };
}

export function formatJoint(jt: ChartJoint): string {
  const size = `${jt.bar.widthMm}×${jt.bar.thicknessMm}`;
  if (jt.phMaterial) return `${jt.runs}R ${size} Ph (${jt.phMaterial}) + ${jt.neRuns}R Ne`;
  return jt.neRuns === jt.runs ? `${jt.runs}R ${size} (Ph & Ne)` : `${jt.runs}R ${size} Ph + ${jt.neRuns}R Ne`;
}

export function formatJoints(joints: ChartJoint[]): string {
  if (joints.length === 1) return formatJoint(joints[0]);
  return joints.map((jt, i) => `${i === 0 ? "1st joint" : "2nd joint"} ${formatJoint(jt)}`).join(", ");
}
