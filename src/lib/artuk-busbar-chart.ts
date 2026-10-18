import type { BarSize } from "@/lib/busbar-plan";

// ABB's ArTuK copper busbar charts ("ArTuK Copper Busbar Length for Emax
// ACB" workbook, one sheet per ACB rating). On ArTuK boards with copper
// busbar the main busbar and each ACB's links come from these charts --
// not from current density. Neutral is always 100% (the charts are drawn
// for 100% Ne, even if the board spec says 50%); the 5000A chart has fewer
// neutral runs than phase runs, as ABB draws it. The HBB position column
// is ignored.
//
// Each chart gives:
//  - the bay size (W × D) ABB designed it for,
//  - the main busbar size,
//  - the "Main busbar to ACB link (Top)" -- the riser / ACB link between the
//    main busbar and the ACB; where it has two joints, the first joint is at
//    the ACB terminal (top link) and the second runs on to the main busbar
//    (dropper),
//  - the "ACB link (Bottom)" -- the bar on the ACB's other terminal, where
//    the cables land (cable link), again as one or two joints,
//  - ABB's cut lengths for every piece, summed here per bar size for each
//    side (all phases + neutral, every run). Weight and BOM use these
//    lengths directly.
//
// Aluminium boards don't use these charts (a separate ruleset, still to come).

export type ChartJoint = { bar: BarSize; runs: number; neRuns: number };

export type ArtukCuChart = {
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
  // total bar length per size (mm), all phases + neutral, every run
  topPieces: { bar: BarSize; lengthMm: number }[];
  bottomPieces: { bar: BarSize; lengthMm: number }[];
};

const b = (widthMm: number): BarSize => ({ widthMm, thicknessMm: 10 });
const j = (runs: number, widthMm: number, neRuns = runs): ChartJoint => ({ bar: b(widthMm), runs, neRuns });
const p = (widthMm: number, lengthMm: number) => ({ bar: b(widthMm), lengthMm });

// Smallest rating first; selection takes the first chart that covers the ACB.
export const ARTUK_CU_CHARTS: ArtukCuChart[] = [
  {
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

export function parseIp(ip: string | null | undefined): number | null {
  const m = (ip ?? "").match(/(\d{2})/);
  return m ? Number(m[1]) : null;
}

export type ChartPick = { chart: ArtukCuChart; warnings: string[] } | null;

// The ABB chart for an ACB: the smallest one whose rating covers the ACB
// and whose short-circuit and IP ratings cover the board's (a chart rated
// higher is fine). The frame must match when the feeder has one. If the
// board's kA / IP is beyond every chart that covers the rating, the
// nearest chart by rating is used with a warning.
export function pickArtukCuChart(args: { amps: number | null; frame?: string | null; ka: number | null; ip: number | null }): ChartPick {
  const { amps, ka, ip } = args;
  if (amps == null || amps <= 0) return null;
  const frame = args.frame?.trim().toUpperCase() || null;
  const byRating = ARTUK_CU_CHARTS.filter((c) => c.maxA >= amps);
  if (byRating.length === 0) {
    const top = ARTUK_CU_CHARTS[ARTUK_CU_CHARTS.length - 1];
    return { chart: top, warnings: [`${amps}A is above ABB's largest ArTuK chart (${top.ratingLabel}) — ${top.ratingLabel} chart used; check with ABB.`] };
  }
  const frameOk = (c: ArtukCuChart) => !frame || c.frames.some((f) => f.toUpperCase() === frame);
  const fits = (c: ArtukCuChart) => (ka == null || c.scKa >= ka) && (ip == null || c.ip >= ip);
  const exact = byRating.find((c) => frameOk(c) && fits(c));
  if (exact) {
    const nominal = byRating[0];
    return {
      chart: exact,
      warnings:
        exact === nominal
          ? []
          : [
              `${amps}A: ABB's ${nominal.ratingLabel} chart only covers ${nominal.scKa}kA / IP${nominal.ip}, so the next chart that covers the board's ${ka != null ? `${ka}kA` : ""}${ka != null && ip != null ? " / " : ""}${ip != null ? `IP${ip}` : ""} (${exact.ratingLabel}) is used — confirm with ABB.`,
            ],
    };
  }
  const warnings: string[] = [];
  const anyFit = byRating.find(fits);
  if (anyFit) {
    warnings.push(`No ABB chart for frame ${args.frame} at ${amps}A — ${anyFit.sheet} chart used.`);
    return { chart: anyFit, warnings };
  }
  const nearest = byRating.find(frameOk) ?? byRating[0];
  if (ka != null && nearest.scKa < ka) warnings.push(`Board is ${ka}kA but ABB's ${nearest.ratingLabel} chart is for ${nearest.scKa}kA — check with ABB.`);
  if (ip != null && nearest.ip < ip) warnings.push(`Board is IP${ip} but ABB's ${nearest.ratingLabel} chart is for IP${nearest.ip} — check with ABB.`);
  return { chart: nearest, warnings };
}

export function formatJoint(jt: ChartJoint): string {
  const size = `${jt.bar.widthMm}×${jt.bar.thicknessMm}`;
  return jt.neRuns === jt.runs ? `${jt.runs}R ${size} (Ph & Ne)` : `${jt.runs}R ${size} Ph + ${jt.neRuns}R Ne`;
}

export function formatJoints(joints: ChartJoint[]): string {
  if (joints.length === 1) return formatJoint(joints[0]);
  return joints.map((jt, i) => `${i === 0 ? "1st joint" : "2nd joint"} ${formatJoint(jt)}`).join(", ");
}
