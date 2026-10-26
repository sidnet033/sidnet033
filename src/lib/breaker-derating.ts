// Breaker current derating for site conditions (ambient temperature and
// altitude), from ABB's technical catalogues:
//  - SACE Emax 2 (1SDC200023D0209, Apr 2024): temperature derating p.7/8,
//    altitude p.7/9, performance in switchgear p.7/16-7/21 (IP31, HR
//    terminals, one breaker in the column, ambient 35/45/55 C),
//  - Formula Air ACB (2024): temperature derating p.36, altitude p.37,
//  - SACE Tmax XT (1SDC210099D0206, Jul 2024): altitude p.1/2, thermal-
//    magnetic trip shift p.1/4-1/5, electronic / magnetic-only max L
//    setting p.1/6-1/7.
// Temperatures between catalogue columns take the next hotter column
// (conservative). The site ambient is the air around the switchboard --
// ABB's "environment temperature" in the in-switchgear tables.

type Temps = [number, number, number, number, number, number, number]; // 40,45,50,55,60,65,70 C
const T_COLS = [40, 45, 50, 55, 60, 65, 70];

export type DeratingInput = {
  category: string | null;
  frame: string | null;
  amps: number | null; // breaker In / Iu
  description: string;
  ambientC: number;
  altitudeM: number;
  // ArTuK boards: use ABB's in-switchgear table for Emax 2 (it already
  // accounts for the heat inside an IP31 panel)
  inPanel: boolean;
};

export type DeratingResult = {
  family: "Emax 2" | "Formula Air" | "Tmax XT";
  frame: string;
  ratedA: number;
  deratedA: number;
  basis: string; // which table, for the warning text
  notes: string[];
};

// --- Emax 2 -----------------------------------------------------------
// % of Iu, fixed and withdrawable, copper per IEC 60947 (p.7/8)
const EMAX2_PCT: Record<string, Record<number, Temps>> = {
  "E1.2": { 1600: [100, 100, 100, 98, 95, 93, 90] },
  "E2.2": { 1600: [100, 100, 100, 100, 100, 100, 98], 2000: [100, 100, 100, 100, 95, 91, 87], 2500: [100, 100, 100, 100, 98, 94, 90] },
  "E4.2": { 3200: [100, 100, 97, 93, 89, 86, 82], 4000: [100, 100, 97, 93, 89, 86, 83] },
  "E6.2": { 5000: [100, 100, 100, 100, 100, 98, 95], 6300: [100, 100, 95, 91, 87, 84, 81] },
};
// A inside an IP31 switchgear at ambient 35 / 45 / 55 C (p.7/16-7/21)
const EMAX2_IN_PANEL: Record<string, Record<number, [number, number, number]>> = {
  "E1.2": { 1250: [1250, 1250, 1200], 1600: [1440, 1360, 1290] },
  "E2.2": { 1600: [1600, 1540, 1480], 2000: [2000, 1940, 1850], 2500: [2400, 2320, 2200] },
  "E4.2": { 2500: [2500, 2450, 2400], 3200: [3050, 2900, 2755], 4000: [3450, 3200, 2970] },
  "E6.2": { 5000: [5000, 5000, 4900], 6300: [5650, 5350, 5100] },
};
const EMAX2_RATINGS: [string, number][] = [
  ["E1.2", 630], ["E1.2", 800], ["E1.2", 1000], ["E1.2", 1250], ["E1.2", 1600],
  ["E2.2", 2000], ["E2.2", 2500], ["E4.2", 3200], ["E4.2", 4000], ["E6.2", 5000], ["E6.2", 6300],
];

// --- Formula Air ------------------------------------------------------
const FORMULA_PCT: Record<string, Record<number, Temps>> = {
  FA1: { 1600: [100, 100, 100, 100, 100, 100, 87.5] },
  FA2: { 1600: [100, 100, 100, 100, 100, 100, 98], 2000: [100, 100, 100, 100, 95, 91, 87] },
  FA4: { 3200: [100, 100, 100, 100, 95, 93, 89], 4000: [100, 100, 97, 93, 89, 86, 83] },
};
const FORMULA_RATINGS: [string, number][] = [
  ["FA1", 630], ["FA1", 800], ["FA1", 1000], ["FA1", 1250], ["FA1", 1600], ["FA2", 2000], ["FA4", 2500], ["FA4", 3200], ["FA4", 4000],
];

// --- Tmax XT ----------------------------------------------------------
// Electronic / magnetic-only / switch-disconnector: max L setting in A
// (p.1/6-1/7), fixed version with front terminals and plug-in /
// withdrawable. XT1-XT4 are only given at 40/50/60/70 C -- 45/55/65 take
// the next hotter column.
type XtRow = { fixed: Temps; drawout: Temps | null };
const t4 = (a: number, b: number, c: number, d: number): Temps => [a, b, b, c, c, d, d];
const XT_ELECTRONIC: Record<string, { upTo: number; row: XtRow }[]> = {
  XT1: [{ upTo: 160, row: { fixed: t4(160, 160, 153, 140), drawout: t4(125, 117, 108, 100) } }],
  XT2: [{ upTo: 160, row: { fixed: t4(160, 160, 160, 145), drawout: t4(160, 160, 160, 148) } }],
  XT3: [{ upTo: 250, row: { fixed: t4(250, 250, 228, 204), drawout: t4(250, 222, 196, 170) } }],
  XT4: [{ upTo: 250, row: { fixed: t4(250, 250, 238, 213), drawout: t4(250, 231, 211, 190) } }],
  XT5: [
    { upTo: 400, row: { fixed: [400, 400, 400, 400, 383, 365, 346], drawout: [400, 385, 370, 355, 338, 321, 302] } },
    { upTo: 630, row: { fixed: [630, 630, 630, 630, 590, 550, 505], drawout: [600, 578, 555, 532, 507, 481, 454] } },
  ],
  XT6: [
    { upTo: 800, row: { fixed: [800, 800, 800, 780, 760, 740, 720], drawout: [800, 780, 760, 740, 720, 680, 640] } },
    { upTo: 1000, row: { fixed: [1000, 980, 960, 918.5, 877, 830.5, 784], drawout: null } },
  ],
  XT7: [
    { upTo: 800, row: { fixed: [800, 800, 800, 800, 800, 750, 700], drawout: [800, 800, 800, 766, 730, 693, 653] } },
    { upTo: 1000, row: { fixed: [1000, 1000, 1000, 971, 942, 885, 827], drawout: [1000, 1000, 961, 920, 877, 832, 784] } },
    { upTo: 1250, row: { fixed: [1250, 1250, 1250, 1184, 1118, 1049, 980], drawout: [1250, 1205, 1157, 1108, 1056, 1002, 945] } },
    { upTo: 1600, row: { fixed: [1600, 1541, 1481, 1417, 1352, 1281, 1209], drawout: [1400, 1350, 1296, 1240, 1183, 1122, 1058] } },
  ],
};
// Thermal-magnetic trip units: the thermal threshold is set at 40 C and
// drops as it gets hotter (p.1/4-1/5) -- factor of In at 45/50/60/70 C,
// from the MAX column of the nearest In row.
type TmRow = { inA: number; f: [number, number, number, number] };
const XT_THERMAL: Record<string, TmRow[]> = {
  XT1: [{ inA: 160, f: [0.969, 0.938, 0.875, 0.813] }],
  XT2: [{ inA: 160, f: [0.964, 0.938, 0.869, 0.844] }], // 154.2 / 150 / 139 / 135A of 160A
  XT3: [{ inA: 250, f: [0.968, 0.932, 0.864, 0.82] }],
  XT4: [
    { inA: 160, f: [0.969, 0.938, 0.856, 0.813] },
    { inA: 200, f: [0.97, 0.95, 0.875, 0.8] },
    { inA: 225, f: [0.969, 0.924, 0.844, 0.756] },
    { inA: 250, f: [0.968, 0.96, 0.92, 0.88] },
  ],
  XT5: [
    { inA: 320, f: [0.969, 0.922, 0.859, 0.781] },
    { inA: 400, f: [0.975, 0.95, 0.875, 0.8] },
    { inA: 500, f: [0.97, 0.94, 0.87, 0.8] },
    { inA: 630, f: [0.976, 0.96, 0.921, 0.873] },
  ],
  XT6: [
    { inA: 630, f: [0.976, 0.96, 0.921, 0.881] },
    { inA: 800, f: [0.975, 0.95, 0.875, 0.8] },
  ],
};
const XT_RATINGS: [string, number][] = [
  ["XT1", 160], ["XT3", 250], ["XT5", 400], ["XT5", 630], ["XT6", 800], ["XT7", 1000], ["XT7", 1250], ["XT7", 1600],
];

// Rated current % above 2000 m (same for Emax 2, Formula Air, Tmax XT)
const ALTITUDE: [number, number][] = [
  [2000, 1],
  [3000, 0.98],
  [4000, 0.93],
  [5000, 0.9],
];

function tempIndex(ambientC: number): number {
  const i = T_COLS.findIndex((t) => ambientC <= t);
  return i < 0 ? T_COLS.length - 1 : i;
}

function altitudeFactor(altitudeM: number): number {
  const step = ALTITUDE.find(([m]) => altitudeM <= m);
  return step ? step[1] : ALTITUDE[ALTITUDE.length - 1][1];
}

export function normalizeFrame(frame: string | null): string | null {
  if (!frame) return null;
  const f = frame.toUpperCase().replace(/\s+/g, "");
  const xt = f.match(/^XT([1-7])/);
  if (xt) return `XT${xt[1]}`;
  const e = f.match(/^E([1246])\.2/);
  if (e) return `E${e[1]}.2`;
  const fa = f.match(/^FA([124])/);
  if (fa) return `FA${fa[1]}`;
  return null;
}

function isDrawout(description: string): boolean {
  // Emax 2: "WMP" moving part; Tmax XT: "... 3p P ..." / "... 4p W ..."
  return /\bWMP\b|\bwithdraw|\bplug-?in\b|\b[34]p\s+[PW]\b/i.test(description);
}

function isThermalMagnetic(description: string): boolean {
  return /\bTM[ADFG]\b|thermal[\s-]*magnetic/i.test(description);
}

function pctOf(table: Record<number, Temps> | undefined, amps: number, ti: number): number {
  const row = table?.[amps];
  return row ? row[ti] : 100;
}

function emax2(frame: string, amps: number, ambientC: number, inPanel: boolean, notes: string[]): { a: number; basis: string } {
  const ti = tempIndex(ambientC);
  const bare = (amps * pctOf(EMAX2_PCT[frame], amps, ti)) / 100;
  if (!inPanel) return { a: bare, basis: "ABB Emax 2 temperature derating" };
  const panel = EMAX2_IN_PANEL[frame]?.[amps];
  if (!panel) return { a: bare, basis: "ABB Emax 2 temperature derating" };
  if (ambientC <= 55) {
    const col = ambientC <= 35 ? 0 : ambientC <= 45 ? 1 : 2;
    return { a: Math.min(bare, panel[col]), basis: "ABB Emax 2 in-switchgear table (IP31, HR terminals)" };
  }
  notes.push("site ambient is above ABB's in-switchgear table (55 °C) — scaled from the 55 °C value");
  const at55 = pctOf(EMAX2_PCT[frame], amps, tempIndex(55));
  return { a: (panel[2] * pctOf(EMAX2_PCT[frame], amps, ti)) / at55, basis: "ABB Emax 2 in-switchgear table (IP31, HR terminals)" };
}

function tmaxXt(frame: string, amps: number, description: string, ambientC: number, notes: string[]): { a: number; basis: string } {
  const ti = tempIndex(ambientC);
  const drawout = isDrawout(description);
  const rows = XT_ELECTRONIC[frame] ?? [];
  const row = (rows.find((r) => amps <= r.upTo) ?? rows[rows.length - 1])?.row;
  let cap = Infinity;
  if (row) {
    const temps = drawout && row.drawout ? row.drawout : row.fixed;
    cap = temps[ti];
  }
  let a = Math.min(amps, cap);
  let basis = `ABB Tmax XT max L setting (${drawout ? "plug-in / withdrawable" : "fixed"})`;
  const tm = XT_THERMAL[frame];
  if (isThermalMagnetic(description) && tm) {
    const near = tm.reduce((best, r) => (Math.abs(r.inA - amps) < Math.abs(best.inA - amps) ? r : best), tm[0]);
    if (ambientC > 40) {
      const fi = ambientC <= 45 ? 0 : ambientC <= 50 ? 1 : ambientC <= 60 ? 2 : 3;
      a = Math.min(a, amps * near.f[fi]);
    }
    basis = "ABB Tmax XT thermal-magnetic trip shift";
  }
  if (frame === "XT6" && drawout && amps > 800) notes.push("XT6 1000 is fixed only");
  return { a, basis };
}

// Derated current of one ACB / MCCB at the site, or null when the breaker
// isn't one the catalogues cover (other makes, older ABB series).
export function derateBreaker(input: DeratingInput): DeratingResult | null {
  const cat = (input.category ?? "").toUpperCase();
  if (cat !== "ACB" && cat !== "MCCB") return null;
  const frame = normalizeFrame(input.frame);
  const amps = input.amps;
  if (!frame || !amps || amps <= 0) return null;
  const notes: string[] = [];
  if (input.ambientC > 70) notes.push("site ambient is above 70 °C — ABB doesn't guarantee breaker performance there");
  if (input.altitudeM > 5000) notes.push("site altitude is above 5000 m — beyond ABB's altitude table");
  if (input.altitudeM > 2000) notes.push("above 2000 m the maximum service voltage also drops — check Ue");

  let family: DeratingResult["family"];
  let r: { a: number; basis: string };
  if (frame.startsWith("E")) {
    family = "Emax 2";
    r = emax2(frame, amps, input.ambientC, input.inPanel, notes);
  } else if (frame.startsWith("FA")) {
    family = "Formula Air";
    r = { a: (amps * pctOf(FORMULA_PCT[frame], amps, tempIndex(input.ambientC))) / 100, basis: "ABB Formula Air temperature derating" };
  } else {
    family = "Tmax XT";
    r = tmaxXt(frame, amps, input.description, input.ambientC, notes);
  }
  const alt = altitudeFactor(input.altitudeM);
  return {
    family,
    frame,
    ratedA: amps,
    deratedA: Math.floor(r.a * alt),
    basis: alt < 1 ? `${r.basis} × altitude ${Math.round(alt * 100)}%` : r.basis,
    notes,
  };
}

// Smallest standard breaker of the same family that still carries
// `requiredA` at the site, e.g. "E2.2 2000" -- or null if none does.
export function suggestBreaker(result: DeratingResult, requiredA: number, input: Omit<DeratingInput, "frame" | "amps">): string | null {
  const list = result.family === "Emax 2" ? EMAX2_RATINGS : result.family === "Formula Air" ? FORMULA_RATINGS : XT_RATINGS;
  for (const [frame, amps] of list) {
    if (amps <= result.ratedA) continue;
    const r = derateBreaker({ ...input, frame, amps, description: "" });
    if (r && r.deratedA >= requiredA) return `${frame} ${amps}A`;
  }
  return null;
}

export type DeratingWarning = {
  key: string;
  feederName: string;
  item: string;
  requiredA: number;
  result: DeratingResult;
  suggestion: string | null;
};

// Every ACB / MCCB line whose derated current is below what its feeder
// needs (the feeder's rated current, or the breaker's own rating when the
// feeder has none).
export function deratingWarnings(args: {
  feeders: { id: string; name: string; rated_current: number | null; items: { id: string; category: string | null; frame: string | null; amps: number | null; description: string }[] }[];
  ambientC: number | null;
  altitudeM: number | null;
  inPanel: boolean;
}): DeratingWarning[] {
  if (args.ambientC == null || args.altitudeM == null) return [];
  const out: DeratingWarning[] = [];
  const seen = new Set<string>();
  for (const f of args.feeders) {
    for (const it of f.items) {
      const key = `${f.id}|${it.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const base = { category: it.category, description: it.description, ambientC: args.ambientC, altitudeM: args.altitudeM, inPanel: args.inPanel };
      const result = derateBreaker({ ...base, frame: it.frame, amps: it.amps });
      if (!result) continue;
      const requiredA = f.rated_current != null && f.rated_current > 0 ? f.rated_current : result.ratedA;
      if (result.deratedA >= requiredA) continue;
      out.push({ key, feederName: f.name, item: it.description, requiredA, result, suggestion: suggestBreaker(result, requiredA, base) });
    }
  }
  return out;
}

export function deratingMessage(w: DeratingWarning): string {
  const r = w.result;
  const need = w.requiredA === r.ratedA ? `its ${r.ratedA}A rating` : `the feeder's ${w.requiredA}A`;
  return (
    `${w.item} (in ${w.feederName}) carries only ${r.deratedA}A at this site, below ${need} — ${r.basis}.` +
    (w.suggestion ? ` Consider ${w.suggestion}.` : "") +
    (r.notes.length ? ` Note: ${r.notes.join("; ")}.` : "")
  );
}

// Why a site needs derating at all: breakers are rated at 40 °C ambient
// and up to 2000 m. Empty when the site is within both.
export const DERATING_FREE_MAX_C = 40;
export const DERATING_FREE_MAX_M = 2000;
export function siteDeratingReasons(ambientC: number | null, altitudeM: number | null): string[] {
  const out: string[] = [];
  if (ambientC != null && ambientC > DERATING_FREE_MAX_C) out.push(`ambient ${ambientC} °C is above ${DERATING_FREE_MAX_C} °C`);
  if (altitudeM != null && altitudeM > DERATING_FREE_MAX_M) out.push(`altitude ${altitudeM} m is above ${DERATING_FREE_MAX_M} m`);
  return out;
}

// Selection tables for How it works: what each standard breaker carries at
// each ambient (sea level), computed from the same catalogue data as the
// check. Only ratings that lose current somewhere up to 70 °C are listed.
export type GuideTable = { title: string; note: string; temps: number[]; rows: { label: string; values: number[] }[] };
export function deratingGuide(): GuideTable[] {
  const at = (frame: string, amps: number, t: number, inPanel: boolean, description = "") =>
    derateBreaker({ category: frame.startsWith("XT") ? "MCCB" : "ACB", frame, amps, description, ambientC: t, altitudeM: 0, inPanel })?.deratedA ?? amps;
  const build = (list: [string, number][], temps: number[], inPanel: boolean, description = "") =>
    list
      .map(([frame, amps]) => ({ label: `${frame} ${amps}A`, values: temps.map((t) => at(frame, amps, t, inPanel, description)), amps }))
      .filter((r) => r.values.some((v) => v < r.amps))
      .map(({ label, values }) => ({ label, values }));
  const hot = [40, 45, 50, 55, 60, 65, 70];
  const emaxAll: [string, number][] = [
    ["E1.2", 1250], ["E1.2", 1600], ["E2.2", 1600], ["E2.2", 2000], ["E2.2", 2500], ["E4.2", 2500], ["E4.2", 3200], ["E4.2", 4000], ["E6.2", 5000], ["E6.2", 6300],
  ];
  const xtAll: [string, number][] = [
    ["XT1", 160], ["XT2", 160], ["XT3", 250], ["XT4", 250], ["XT5", 400], ["XT5", 630], ["XT6", 800], ["XT6", 1000], ["XT7", 800], ["XT7", 1000], ["XT7", 1250], ["XT7", 1600],
  ];
  return [
    { title: "Emax 2 — in an ArTuK panel (A)", note: "ABB in-switchgear table: IP31, HR terminals, one breaker in the column. Columns are the site ambient around the panel.", temps: [35, 45, 55], rows: build(emaxAll, [35, 45, 55], true) },
    { title: "Emax 2 — breaker alone (A)", note: "Fixed or withdrawable, copper connections. Used for non-ArTuK boards.", temps: hot, rows: build(emaxAll, hot, false) },
    { title: "Formula Air (A)", note: "Fixed or withdrawable.", temps: hot, rows: build(FORMULA_RATINGS, hot, false) },
    { title: "Tmax XT, electronic trip — fixed (A)", note: "Maximum L setting with front terminals.", temps: hot, rows: build(xtAll, hot, false) },
    { title: "Tmax XT, electronic trip — plug-in / withdrawable (A)", note: "Maximum L setting.", temps: hot, rows: build(xtAll, hot, false, "3p W") },
    { title: "Tmax XT, thermal-magnetic trip (A)", note: "The thermal trip point drops above 40 °C.", temps: hot, rows: build(xtAll.filter(([f, a]) => f !== "XT7" && !(f === "XT6" && a > 800)), hot, false, "TMA") },
  ];
}
export const ALTITUDE_TABLE = ALTITUDE;
