// PK2025 BOM import: the company's own "Bill Of Quantity" sheet layout
// (e.g. R2 BOQ for the Sterling Wilson / Hiranandani 4x2000kVA sync panel).
//
// Layout (first worksheet):
//   header row:   SR.No | Description | Make | Qty | Units | Part no. | Remarks
//   section row:  A     | DG INCOMER, ACB 3200A 3P ... | | FEEDER QTY | 4
//   item rows:    1     | ACB, 3200A, 3P ...           | ABB | 4 | NOS | 2SWACBI326
//   ...           (numbering restarts for sub-groups, blank rows between)
//   N MISC ITEM / O BUSBAR DETAILS / P General : -- sections with no feeder
//   qty; rows with no SR.No (lump sums) are ignored.
// Every item qty is the TOTAL for all of that section's feeders; the app
// stores qty per feeder (total / feeder qty).
//
// An optional worksheet whose name mentions "busbar" (e.g. "Busbar list
// boq") is kept as plain text for the busbar section's remarks.

import type { Feeder } from "@/types/database";

export type Cell = string | number | null;
export type SheetRows = Cell[][]; // row-major, column A = index 0

export const PK2025_COLUMNS = [
  "SR.No",
  "Description",
  "Make",
  "Qty",
  "Units",
  "Part no.",
  "Remarks",
] as const;

export type SectionKind = "feeder" | "misc" | "general" | "busbar";

export type PkItem = {
  row: number; // 1-based sheet row
  sr: string;
  description: string;
  make: string;
  qty: number; // total for the section
  unit: string;
  partNo: string | null; // null = blank / "NEED TO GEN PART"
};

export type PkSection = {
  letter: string;
  title: string;
  row: number;
  kind: SectionKind;
  feederQty: number | null;
  items: PkItem[];
};

export type PkParse = {
  project: string | null;
  panel: string | null;
  sections: PkSection[];
  errors: string[];
};

const text = (c: Cell | undefined) =>
  c == null ? "" : String(c).replace(/\s+/g, " ").trim();
const num = (c: Cell | undefined): number | null => {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const t = text(c);
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

function sectionKind(title: string): SectionKind {
  const t = title.toLowerCase();
  if (/\bmisc/.test(t)) return "misc";
  if (/\bgeneral\b/.test(t)) return "general";
  if (/\bbus\s*bar\b|\bbusbar\b/.test(t) && !/\b(acb|mccb|feeder)\b/.test(t))
    return "busbar";
  return "feeder";
}

/** Parse the BOQ sheet; `errors` non-empty means the file isn't PK2025. */
export function parsePk2025(rows: SheetRows): PkParse {
  const errors: string[] = [];
  let project: string | null = null;
  let panel: string | null = null;

  const header = rows.findIndex((r) => {
    const a = text(r?.[0]).toLowerCase().replace(/[^a-z]/g, "");
    const b = text(r?.[1]).toLowerCase();
    return a === "srno" && b.startsWith("description");
  });
  for (const r of rows.slice(0, header < 0 ? 15 : header)) {
    for (const c of r ?? []) {
      const t = text(c);
      const m = /^PROJECT\/CUSTOMER NAME\s*:\s*(.+)$/i.exec(t);
      if (m) project = m[1].trim();
      const p = /^PANEL DESCRIPTION\s*:?-?\s*(.+)$/i.exec(t);
      if (p) panel = p[1].trim();
    }
  }
  if (header < 0) {
    errors.push(
      `No header row found. Expected a row starting "${PK2025_COLUMNS.slice(0, 6).join(" | ")}".`,
    );
    return { project, panel, sections: [], errors };
  }
  const h = rows[header].map((c) => text(c).toLowerCase());
  const expect: [number, RegExp, string][] = [
    [2, /^make/, "Make"],
    [3, /^qty|^quantity/, "Qty"],
    [4, /^unit/, "Units"],
    [5, /^part/, "Part no."],
  ];
  for (const [i, re, name] of expect)
    if (!re.test(h[i] ?? ""))
      errors.push(
        `Column ${String.fromCharCode(65 + i)} of the header row should be "${name}" (found "${text(rows[header][i]) || "blank"}").`,
      );
  if (errors.length) return { project, panel, sections: [], errors };

  const sections: PkSection[] = [];
  let current: PkSection | null = null;
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const a = text(r[0]);
    const b = text(r[1]);
    if (!a && !b) continue;
    if (/^format no/i.test(a) || /^prepared by/i.test(a)) break;
    // section: a letter (A, B, ... AA) with a title
    if (/^[A-Z]{1,2}$/.test(a) && b) {
      const title = b.replace(/\s*:\s*$/, "");
      const kind = sectionKind(title);
      const feederQty = /feeder\s*qty/i.test(text(r[3])) ? num(r[4]) : null;
      current = { letter: a, title, row: i + 1, kind, feederQty, items: [] };
      sections.push(current);
      if (kind === "feeder" && (feederQty == null || feederQty <= 0))
        errors.push(
          `Row ${i + 1}: feeder "${a} ${title}" has no FEEDER QTY (column D "FEEDER QTY", the number in column E).`,
        );
      continue;
    }
    // item: a serial number, a description, a quantity
    const sr = num(r[0]);
    if (sr == null) continue; // lump sums / notes without a serial number
    if (!current) {
      errors.push(
        `Row ${i + 1}: an item comes before the first feeder heading (a letter A, B, C... with the feeder name).`,
      );
      continue;
    }
    if (!b) continue;
    const qty = num(r[3]);
    if (qty == null || qty <= 0) continue; // dropped in this revision
    const part = text(r[5]);
    current.items.push({
      row: i + 1,
      sr: a,
      description: b,
      make: text(r[2]),
      qty,
      unit: text(r[4]),
      partNo: !part || /need to gen/i.test(part) ? null : part,
    });
  }
  if (!sections.some((s) => s.kind === "feeder"))
    errors.push("No feeders found (sections A, B, C... with a FEEDER QTY).");
  return { project, panel, sections, errors };
}

/** Busbar list sheet as plain text, one line per row (blank cells dropped). */
export function busbarSheetText(rows: SheetRows): string {
  return rows
    .map((r) =>
      (r ?? [])
        .map((c) => text(c))
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean)
    .join("\n");
}

// ---- feeder guess from the section title ----

export type FeederGuess = {
  name: string;
  category: "Incomer" | "Outgoing" | "Bus Coupler" | "Others";
  deviceType: Feeder["device_type"];
  ratedCurrent: number | null;
  poles: "3-Pole (3P)" | "4-Pole (4P)" | null;
};

export function guessFeeder(title: string): FeederGuess {
  const t = title.toUpperCase();
  const device: Feeder["device_type"] = /\bACB\b/.test(t)
    ? "ACB"
    : /\bMCCB\b/.test(t)
      ? "MCCB"
      : /\bMCB\b/.test(t)
        ? "MCB"
        : /\bRDOL\b/.test(t)
          ? "RDOL"
          : /\bDOL\b/.test(t)
            ? "DOL"
            : /STAR.?DELTA|\bS\/D\b/.test(t)
              ? "STAR_DELTA"
              : /\bVFD\b/.test(t)
                ? "VFD"
                : null;
  const amps = /(\d{2,5})\s*A\b/.exec(t);
  const poles = /\b([34])\s*P\b/.exec(t);
  const category: FeederGuess["category"] = /B\/C|BUS\s*COUPLER|BUSCOUPLER/.test(
    t,
  )
    ? "Bus Coupler"
    : /INCOMER|\bI\/C\b/.test(t)
      ? "Incomer"
      : /O\/G|OUTGOING/.test(t)
        ? "Outgoing"
        : "Others";
  return {
    name: title,
    category,
    deviceType: device,
    ratedCurrent: amps ? Number(amps[1]) : null,
    poles: poles ? (poles[1] === "4" ? "4-Pole (4P)" : "3-Pole (3P)") : null,
  };
}

// ---- new item guesses ----

const PREFIX_CATEGORY: [RegExp, string][] = [
  [/^2SWACB/i, "ACB"],
  [/^2ACACB/i, "ACB_ACC"],
  [/^2SWMCC/i, "MCCB"],
  [/^2ACMCC/i, "MCCB_ACC"],
  [/^2SWMCB/i, "MCB"],
  [/^2SWCON/i, "CONTACTOR"],
  [/^2ACCON/i, "CONTACTOR_ACC"],
  [/^2SW(AXR|CNR|RBS)/i, "AUXILIARY RELAY"],
  [/^2CA/i, "CABLE/WIRE"],
  [/^2CT/i, "CURRENT TRANSFORMER"],
  [/^2MT/i, "METER"],
  [/^2MSLUG/i, "LUG"],
  [/^2MSTER/i, "CONNECTOR"],
  [/^2PR/i, "SWITCHGEAR & PROTECTION"],
];
const WORD_CATEGORY: [RegExp, string][] = [
  [/^ACB\b/i, "ACB"],
  [/^ACB |shunt|closing release|gear motor|under voltage release/i, "ACB_ACC"],
  [/^MCCB\b/i, "MCCB"],
  [/^MCB\b/i, "MCB"],
  [/^contactor/i, "CONTACTOR"],
  [/relay/i, "AUXILIARY RELAY"],
  [/^cable/i, "CABLE/WIRE"],
  [/current transformer/i, "CURRENT TRANSFORMER"],
  [/meter/i, "METER"],
  [/^lugs?\b/i, "LUG"],
  [/terminal/i, "CONNECTOR"],
];

export function guessItemCategory(partNo: string | null, desc: string) {
  for (const [re, c] of PREFIX_CATEGORY) if (partNo && re.test(partNo)) return c;
  for (const [re, c] of WORD_CATEGORY) if (re.test(desc)) return c;
  return "";
}

/** "Cat no: 1SDA073669R1" -> "1SDA073669R1" (placeholders like XX ignored) */
export function catNoOf(desc: string): string {
  const m = /cat\.?\s*no\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/.]{2,})/i.exec(desc);
  if (!m) return "";
  const v = m[1].replace(/[.,]+$/, "");
  return /^X+$/i.test(v) ? "" : v;
}

// ---- spreading section totals over feeders ----

export type Target = { key: string; qty: number }; // a feeder and its qty

/**
 * Per-feeder quantities for an item whose `total` belongs to `target`
 * (a feeder of qty F). Divides evenly when it can; otherwise the target
 * takes floor(total / F) each and the remainder goes to another feeder that
 * divides it (feeders of qty 1 first). `fractional` is set when nothing
 * divides it -- the target then takes total / F (rounded to 3 places).
 */
export function spreadQty(
  total: number,
  target: Target,
  others: Target[],
): { key: string; perFeeder: number }[] & { fractional?: boolean } {
  const F = target.qty;
  const exact = total / F;
  if (Number.isInteger(exact)) return [{ key: target.key, perFeeder: exact }];
  const base = Math.floor(total / F);
  const rem = total - base * F;
  const pick = [...others]
    .filter((o) => o.key !== target.key && o.qty > 0)
    .sort((a, b) => a.qty - b.qty)
    .find((o) => Number.isInteger(rem / o.qty));
  if (pick) {
    const out: { key: string; perFeeder: number }[] = [];
    if (base > 0) out.push({ key: target.key, perFeeder: base });
    out.push({ key: pick.key, perFeeder: rem / pick.qty });
    return out;
  }
  const res = [
    { key: target.key, perFeeder: Math.round(exact * 1000) / 1000 },
  ] as { key: string; perFeeder: number }[] & { fractional?: boolean };
  res.fractional = true;
  return res;
}

// ---- the import plan: which feeders, with which per-feeder lines ----

export type SectionAction = "import" | "merge" | "skip";
export type SectionChoice = {
  letter: string;
  action: SectionAction;
  /** merge target (a section imported as a feeder) */
  target: string | null;
  guess: FeederGuess;
};

export type PlanLine = {
  key: string; // part no., or the description when there is none
  partNo: string | null;
  description: string;
  make: string;
  unit: string;
  perFeeder: number;
  /** fraction: doesn't divide evenly -- check it; spread: part of a merged
   * item's quantity was moved to another feeder to keep whole numbers */
  flags: ("fraction" | "spread")[];
  from: string[]; // section letters the qty came from
};

export type PlanFeeder = {
  letter: string;
  qty: number;
  guess: FeederGuess;
  lines: PlanLine[];
};

export const lineKey = (partNo: string | null, description: string) =>
  partNo ? partNo.trim().toUpperCase() : `d:${description.toLowerCase()}`;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildPlan(
  sections: PkSection[],
  choices: SectionChoice[],
): { feeders: PlanFeeder[]; problems: string[] } {
  const problems: string[] = [];
  const choiceOf = new Map(choices.map((c) => [c.letter, c]));
  const feeders: PlanFeeder[] = sections
    .filter((s) => choiceOf.get(s.letter)?.action === "import")
    .map((s) => ({
      letter: s.letter,
      qty: s.feederQty && s.feederQty > 0 ? s.feederQty : 1,
      guess: choiceOf.get(s.letter)!.guess,
      lines: [],
    }));
  const byLetter = new Map(feeders.map((f) => [f.letter, f]));
  const add = (
    f: PlanFeeder,
    it: PkItem,
    perFeeder: number,
    flag: "fraction" | "spread" | null,
    from: string,
  ) => {
    const key = lineKey(it.partNo, it.description);
    let l = f.lines.find((x) => x.key === key);
    if (!l) {
      l = {
        key,
        partNo: it.partNo,
        description: it.description,
        make: it.make,
        unit: it.unit,
        perFeeder: 0,
        flags: [],
        from: [],
      };
      f.lines.push(l);
    }
    l.perFeeder = round3(l.perFeeder + perFeeder);
    if (flag && !l.flags.includes(flag)) l.flags.push(flag);
    if (!l.from.includes(from)) l.from.push(from);
  };

  for (const s of sections) {
    const c = choiceOf.get(s.letter);
    if (!c || c.action === "skip") continue;
    if (c.action === "import") {
      const f = byLetter.get(s.letter)!;
      for (const it of s.items) {
        const per = it.qty / f.qty;
        add(
          f,
          it,
          round3(per),
          Number.isInteger(per) ? null : "fraction",
          s.letter,
        );
      }
      continue;
    }
    // merge: section totals go into the target feeder (per feeder), any
    // remainder that doesn't divide is spread to another feeder
    const target = c.target ? byLetter.get(c.target) : undefined;
    if (!target) {
      problems.push(`Choose which feeder "${s.letter} ${s.title}" merges into.`);
      continue;
    }
    const others = feeders
      .filter((f) => f.letter !== target.letter)
      .map((f) => ({ key: f.letter, qty: f.qty }));
    for (const it of s.items) {
      const spread = spreadQty(
        it.qty,
        { key: target.letter, qty: target.qty },
        others,
      );
      for (const part of spread)
        add(
          byLetter.get(part.key)!,
          it,
          part.perFeeder,
          spread.fractional ? "fraction" : spread.length > 1 ? "spread" : null,
          s.letter,
        );
    }
  }
  return { feeders, problems };
}
