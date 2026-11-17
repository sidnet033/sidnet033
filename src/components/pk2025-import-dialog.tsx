"use client";

import { useMemo, useRef, useState } from "react";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { SavingOverlay } from "@/components/saving-overlay";
import { numericKeyGuard } from "@/lib/numeric-input";
import { ensureUnassignedVertical } from "@/lib/switchboard-bom";
import {
  isBreakerCategory,
  isFrameRequiredCategory,
  itemCode,
} from "@/lib/item-display";
import {
  createMissingItems,
  validateMissingDraft,
  type MissingItemDraft,
} from "@/lib/feeder-import";
import {
  PK2025_COLUMNS,
  buildPlan,
  busbarSheetText,
  catNoOf,
  guessFeeder,
  guessItemCategory,
  parsePk2025,
  type Cell,
  type FeederGuess,
  type PkParse,
  type PlanFeeder,
  type SectionChoice,
  type SheetRows,
} from "@/lib/pk2025-bom";
import type { Feeder, ItemMaster, ItemSource } from "@/types/database";

// BOM Builder -> "Import PK2025 BOM": reads the company's own BOQ sheet,
// lets the user merge General / Misc (or any section) into a feeder, create
// the items Item Master doesn't have yet, then adds the feeders to this
// switchboard (add only -- nothing already there is changed).

type Stage = "upload" | "sections" | "items" | "importing" | "done";
type MissingRow = MissingItemDraft & {
  lineKey: string;
  mode: "create" | "existing" | "skip";
  existingCode: string;
  error?: string;
};

const CATEGORIES: FeederGuess["category"][] = [
  "Incomer",
  "Outgoing",
  "Bus Coupler",
  "Others",
];
const DEVICES: NonNullable<Feeder["device_type"]>[] = [
  "ACB",
  "MCCB",
  "MCB",
  "DOL",
  "RDOL",
  "STAR_DELTA",
  "VFD",
  "SOFT_STARTER",
  "OTHER",
];

// worksheet -> plain rows (formula results, rich text, merged cells once)
function sheetRows(ws: ExcelJS.Worksheet): SheetRows {
  const rows: SheetRows = [];
  const cols = ws.columnCount;
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const r: Cell[] = [];
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      if (cell.isMerged && cell.master.address !== cell.address) {
        r.push(null);
        continue;
      }
      let v: unknown = cell.value;
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if ("result" in o) v = o.result;
        else if ("richText" in o)
          v = (o.richText as { text: string }[]).map((t) => t.text).join("");
        else if ("text" in o) v = o.text;
        else v = null;
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
      }
      r.push(typeof v === "number" || typeof v === "string" ? v : null);
    }
    rows[n - 1] = r;
  });
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  return rows;
}

async function downloadFormat() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ");
  ws.columns = [
    { width: 8 },
    { width: 70 },
    { width: 14 },
    { width: 12 },
    { width: 10 },
    { width: 16 },
    { width: 24 },
  ];
  ws.addRow(["Company", "Bill Of Quantity", null, null, "Rev No.", 0]);
  ws.addRow([null, "PROJECT/CUSTOMER NAME : <project>"]);
  ws.addRow([null, "PANEL DESCRIPTION:- <panel>"]);
  ws.addRow([]);
  ws.addRow([...PK2025_COLUMNS]).font = { bold: true };
  ws.addRow(["A", "ACB 3200A 3P DG INCOMER", null, "FEEDER QTY", 4]).font = {
    bold: true,
  };
  ws.addRow([1, "ACB, 3200A, 3P ... Cat no: 1SDX...", "ABB", 4, "NOS", "2SWACBI326"]);
  ws.addRow([2, "Indicating Lamp, 230VAC, Red LED ...", "ABB", 12, "NOS", "2ILINDXX158"]);
  ws.addRow([]);
  ws.addRow([1, "Cable, 1.5 Sqmm ... Red", "POLYCAB", 1200, "Meter", "2CAXXXA457"]);
  ws.addRow([]);
  ws.addRow(["B", "MCCB 400A 3P O/G", null, "FEEDER QTY", 2]).font = { bold: true };
  ws.addRow([1, "MCCB, 400A, 3P ...", "ABB", 2, "NOS", "<part no.>"]);
  ws.addRow([]);
  ws.addRow(["N", "MISC ITEM"]).font = { bold: true };
  ws.addRow([1, "Fire Suppression System", "Reputed", 1, "NOS", "NEED TO GEN PART"]);
  ws.addRow(["P", "General :"]).font = { bold: true };
  ws.addRow([1, "Space Heater, 80 Watts ...", "Girish", 15, "SET", "2MSSPHXX03"]);
  ws.addRow([]);
  ws.addRow([
    null,
    "Notes: Qty is the total for all of a section's feeders (the app divides by FEEDER QTY). Rows without an SR.No are ignored. Optional 2nd sheet named 'Busbar list ...' goes to the busbar remarks.",
  ]);
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "PK2025-BOM-format.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

export function Pk2025ImportDialog({
  switchboardId,
  items,
  dirty,
  onImported,
}: {
  switchboardId: string;
  items: ItemMaster[];
  /** the BOM has unsaved changes -- import is blocked until saved */
  dirty: boolean;
  onImported: (createdItems: ItemMaster[]) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("upload");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<PkParse | null>(null);
  const [busbarText, setBusbarText] = useState("");
  const [choices, setChoices] = useState<SectionChoice[]>([]);
  const [plan, setPlan] = useState<PlanFeeder[]>([]);
  const [qtyEdits, setQtyEdits] = useState<Map<string, number>>(new Map());
  const [missing, setMissing] = useState<MissingRow[]>([]);
  const [created, setCreated] = useState<ItemMaster[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [openFeeder, setOpenFeeder] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const allItems = useMemo(() => [...items, ...created], [items, created]);
  const bySku = useMemo(() => {
    const m = new Map<string, ItemMaster>();
    for (const it of allItems) {
      if (it.sku) m.set(it.sku.trim().toUpperCase(), it);
      if (it.vendor_cat && !m.has(it.vendor_cat.trim().toUpperCase()))
        m.set(it.vendor_cat.trim().toUpperCase(), it);
    }
    return m;
  }, [allItems]);
  const categories = useMemo(
    () =>
      [...new Set(items.map((i) => i.category).filter(Boolean) as string[])]
        .sort(),
    [items],
  );

  function reset() {
    setStage("upload");
    setFileName("");
    setParsed(null);
    setBusbarText("");
    setChoices([]);
    setPlan([]);
    setQtyEdits(new Map());
    setMissing([]);
    setProblems([]);
    setResult(null);
  }
  function close() {
    setOpen(false);
    reset();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setBusy("Reading the file…");
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const boq = wb.worksheets[0];
      if (!boq) throw new Error("The file has no worksheets.");
      const p = parsePk2025(sheetRows(boq));
      setParsed(p);
      const bb = wb.worksheets.find(
        (w, i) => i > 0 && /bus\s*bar/i.test(w.name),
      );
      setBusbarText(bb ? busbarSheetText(sheetRows(bb)) : "");
      if (p.errors.length) return;
      setChoices(
        p.sections.map((s) => ({
          letter: s.letter,
          action:
            s.kind === "feeder" ? "import" : s.kind === "busbar" ? "skip" : "merge",
          target: null,
          guess: guessFeeder(s.title),
        })),
      );
      setStage("sections");
    } catch (err) {
      setParsed({
        project: null,
        panel: null,
        sections: [],
        errors: [
          `Could not read the file: ${err instanceof Error ? err.message : String(err)}`,
        ],
      });
    } finally {
      setBusy(null);
    }
  }

  function setChoice(letter: string, patch: Partial<SectionChoice>) {
    setChoices((cs) =>
      cs.map((c) => (c.letter === letter ? { ...c, ...patch } : c)),
    );
  }
  function setGuess(letter: string, patch: Partial<FeederGuess>) {
    setChoices((cs) =>
      cs.map((c) =>
        c.letter === letter ? { ...c, guess: { ...c.guess, ...patch } } : c,
      ),
    );
  }

  function toItems() {
    if (!parsed) return;
    const { feeders, problems: probs } = buildPlan(parsed.sections, choices);
    if (feeders.length === 0) probs.push("Import at least one feeder.");
    setProblems(probs);
    if (probs.length) return;
    setPlan(feeders);
    setQtyEdits(new Map());
    // lines whose part no. isn't in Item Master
    const seen = new Map<string, MissingRow>();
    for (const f of feeders)
      for (const l of f.lines) {
        if (l.partNo && bySku.has(l.partNo.toUpperCase())) continue;
        if (seen.has(l.key)) continue;
        const sku = l.partNo ?? "";
        const cat = catNoOf(l.description);
        seen.set(l.key, {
          key: l.key,
          lineKey: l.key,
          sku,
          vendorCat: cat,
          description: l.description,
          make: l.make,
          category: guessItemCategory(l.partNo, l.description),
          source: sku ? "Design" : "Estimation",
          amps: "",
          poles: "",
          ka: "",
          frame: "",
          unitCost: "0",
          create: true,
          uom: (l.unit || "nos").toLowerCase(),
          mode: "create",
          existingCode: "",
        });
      }
    setMissing([...seen.values()]);
    setOpenFeeder(null);
    setStage("items");
  }

  // the Item Master item a line resolves to (or null)
  function itemFor(key: string, partNo: string | null): ItemMaster | null {
    if (partNo) {
      const hit = bySku.get(partNo.toUpperCase());
      if (hit) return hit;
    }
    const m = missing.find((r) => r.lineKey === key);
    if (m?.mode === "existing" && m.existingCode.trim())
      return bySku.get(m.existingCode.trim().toUpperCase()) ?? null;
    if (m?.mode === "create") {
      const code = (m.sku || m.vendorCat).trim().toUpperCase();
      return code ? (bySku.get(code) ?? null) : null;
    }
    return null;
  }
  const skipped = (key: string) =>
    missing.find((r) => r.lineKey === key)?.mode === "skip";

  const unresolved = plan.flatMap((f) =>
    f.lines.filter((l) => !skipped(l.key) && !itemFor(l.key, l.partNo)),
  );
  const toCreate = missing.filter(
    (r) => r.mode === "create" && !itemFor(r.lineKey, null),
  );

  function patchMissing(key: string, patch: Partial<MissingRow>) {
    setMissing((rows) =>
      rows.map((r) =>
        r.lineKey === key ? { ...r, ...patch, error: undefined } : r,
      ),
    );
  }

  async function createItems() {
    const bad = toCreate
      .map((r) => ({ r, err: validateMissingDraft(r) }))
      .filter((x) => x.err);
    if (bad.length) {
      setMissing((rows) =>
        rows.map((r) => {
          const b = bad.find((x) => x.r.lineKey === r.lineKey);
          return b ? { ...r, error: b.err! } : r;
        }),
      );
      return;
    }
    setBusy(`Creating ${toCreate.length} item(s)…`);
    const { created: made, errors } = await createMissingItems(
      supabase,
      toCreate,
    );
    setBusy(null);
    setCreated((c) => [...c, ...made]);
    if (errors.length)
      setMissing((rows) =>
        rows.map((r) => {
          const e = errors.find((x) => x.key === r.key);
          return e
            ? {
                ...r,
                error: /row-level security/i.test(e.reason)
                  ? "Only admins can add items to Item Master."
                  : e.reason,
              }
            : r;
        }),
      );
  }

  const qtyOf = (letter: string, key: string, fallback: number) =>
    qtyEdits.get(`${letter}|${key}`) ?? fallback;

  async function runImport() {
    setStage("importing");
    setBusy("Adding feeders…");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const vId = await ensureUnassignedVertical(supabase, switchboardId);
      let feederCount = 0;
      let lineCount = 0;
      for (const f of plan) {
        const g = f.guess;
        const { data: fd, error } = await supabase
          .from("feeders")
          .insert({
            name: g.name.trim() || `Feeder ${f.letter}`,
            category: g.category,
            device_type: g.deviceType,
            rated_current: g.ratedCurrent,
            pole_config: g.poles,
            switchboard_id: switchboardId,
            is_library: false,
            created_by: user?.id,
          })
          .select("id")
          .single();
        if (error || !fd) throw new Error(error?.message ?? "Could not add a feeder.");
        const fid = (fd as { id: string }).id;
        // one row per item (lines that resolve to the same item add up)
        const rows = new Map<string, number>();
        for (const l of f.lines) {
          if (skipped(l.key)) continue;
          const it = itemFor(l.key, l.partNo);
          const q = qtyOf(f.letter, l.key, l.perFeeder);
          if (!it || !(q > 0)) continue;
          rows.set(it.id, (rows.get(it.id) ?? 0) + q);
        }
        if (rows.size) {
          const { error: le } = await supabase.from("feeder_items").insert(
            [...rows.entries()].map(([item_id, qty], i) => ({
              feeder_id: fid,
              item_id,
              qty,
              sort_order: i,
            })),
          );
          if (le) throw new Error(le.message);
          lineCount += rows.size;
        }
        const { error: pe } = await supabase.from("placed_feeders").insert({
          vertical_id: vId,
          feeder_id: fid,
          qty: f.qty,
          tier_number: 1,
          sort_order: 0,
        });
        if (pe) throw new Error(pe.message);
        feederCount++;
      }
      if (busbarText.trim()) {
        const { data: sbRow } = await supabase
          .from("switchboards")
          .select("busbar_remarks")
          .eq("id", switchboardId)
          .single();
        const prev = (sbRow as { busbar_remarks: string | null } | null)
          ?.busbar_remarks;
        const note = `Busbar list from ${fileName}:\n${busbarText.trim()}`;
        const { error: be } = await supabase
          .from("switchboards")
          .update({ busbar_remarks: prev ? `${prev}\n\n${note}` : note })
          .eq("id", switchboardId);
        if (be) throw new Error(be.message);
      }
      setResult(
        `Added ${feederCount} feeder(s) with ${lineCount} item line(s)${busbarText.trim() ? ", and the busbar list to the busbar remarks" : ""}.`,
      );
      setStage("done");
      onImported(created);
    } catch (e) {
      setResult(
        `Import stopped: ${e instanceof Error ? e.message : String(e)}. Feeders added before the error stay in the BOM.`,
      );
      setStage("done");
      onImported(created);
    } finally {
      setBusy(null);
    }
  }

  const feederOptions = choices.filter((c) => c.action === "import");
  const input =
    "rounded border border-surface-container-high bg-surface-container-lowest px-1.5 py-1 text-xs";

  return (
    <>
      <button
        onClick={() => {
          if (dirty) {
            alert("Save or cancel your BOM changes before importing.");
            return;
          }
          setOpen(true);
        }}
        title="Import a BOM sheet in the PK2025 format (feeders A, B, C… with FEEDER QTY)"
        className="btn btn-outline btn-sm"
      >
        <Icon name="upload_file" size={14} /> Import PK2025 BOM
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4 backdrop-blur-sm">
          <SavingOverlay show={!!busy} label={busy ?? ""} />
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl">
            <div className="flex items-center justify-between border-b border-surface-container-high px-5 py-3">
              <div>
                <h3 className="text-base font-semibold text-on-surface">
                  Import PK2025 BOM
                </h3>
                <p className="text-[11px] text-on-surface-variant">
                  {stage === "upload" && "1. Choose the BOM file"}
                  {stage === "sections" &&
                    "2. Feeders — merge General / Misc into a feeder"}
                  {stage === "items" && "3. Items — create what Item Master is missing"}
                  {(stage === "importing" || stage === "done") && "4. Import"}
                  {fileName ? ` · ${fileName}` : ""}
                </p>
              </div>
              <button
                onClick={close}
                className="rounded p-1 text-secondary hover:bg-surface-container"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
              {stage === "upload" && (
                <div className="space-y-3">
                  <p className="text-on-surface-variant">
                    Feeders are added to this switchboard; nothing already in
                    its BOM is changed.
                  </p>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".xlsx"
                    onChange={handleFile}
                    className="hidden"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => inputRef.current?.click()}
                      className="btn btn-primary btn-sm"
                    >
                      <Icon name="upload_file" size={14} /> Choose .xlsx
                    </button>
                    <button
                      onClick={downloadFormat}
                      className="btn btn-outline btn-sm"
                    >
                      <Icon name="download" size={14} /> Download the format
                    </button>
                  </div>
                  {parsed && parsed.errors.length > 0 && (
                    <div className="rounded-lg border border-error/40 bg-error-container/30 p-3 text-xs">
                      <p className="mb-1 font-semibold text-error">
                        This file isn&apos;t in the PK2025 format — nothing was
                        imported.
                      </p>
                      <ul className="ml-4 list-disc space-y-0.5 text-on-surface">
                        {parsed.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                      <p className="mt-2 text-on-surface-variant">
                        Expected: a header row{" "}
                        <b>{PK2025_COLUMNS.join(" | ")}</b>; each feeder starts
                        with a letter (A, B, C…) and its name, with{" "}
                        <b>FEEDER QTY</b> in column D and the number in column
                        E; item rows have a serial number, description, make,
                        qty (total for all that feeder&apos;s units), unit and
                        part no. Use &quot;Download the format&quot; for a
                        sample.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {stage === "sections" && parsed && (
                <div className="space-y-3">
                  {(parsed.project || parsed.panel) && (
                    <p className="text-xs text-on-surface-variant">
                      {parsed.project}
                      {parsed.panel ? ` · ${parsed.panel}` : ""}
                    </p>
                  )}
                  <table className="w-full border-collapse text-xs">
                    <thead className="text-left text-[11px] uppercase text-secondary">
                      <tr className="border-b border-surface-container-high">
                        <th className="py-1 pr-2">Sec.</th>
                        <th className="py-1 pr-2">From the sheet</th>
                        <th className="py-1 pr-2 text-right">Feeder qty</th>
                        <th className="py-1 pr-2 text-right">Items</th>
                        <th className="py-1 pr-2">Do</th>
                        <th className="py-1">Feeder details / merge into</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.sections.map((s) => {
                        const c = choices.find((x) => x.letter === s.letter)!;
                        return (
                          <tr
                            key={s.letter}
                            className="border-b border-surface-container align-top"
                          >
                            <td className="py-1.5 pr-2 font-bold">{s.letter}</td>
                            <td className="max-w-[16rem] py-1.5 pr-2">
                              {s.title}
                              {s.kind !== "feeder" && (
                                <span className="ml-1 rounded bg-surface-container px-1 text-[10px] uppercase text-secondary">
                                  {s.kind}
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 pr-2 text-right">
                              {s.feederQty ?? "—"}
                            </td>
                            <td className="py-1.5 pr-2 text-right">
                              {s.items.length}
                            </td>
                            <td className="py-1.5 pr-2">
                              <select
                                value={c.action}
                                onChange={(e) =>
                                  setChoice(s.letter, {
                                    action: e.target.value as SectionChoice["action"],
                                  })
                                }
                                className={input}
                              >
                                <option value="import">Import as feeder</option>
                                <option value="merge">Merge into…</option>
                                <option value="skip">Skip</option>
                              </select>
                            </td>
                            <td className="py-1.5">
                              {c.action === "import" && (
                                <div className="flex flex-wrap gap-1">
                                  <input
                                    value={c.guess.name}
                                    onChange={(e) =>
                                      setGuess(s.letter, { name: e.target.value })
                                    }
                                    className={`${input} w-56`}
                                    title="Feeder name"
                                  />
                                  <select
                                    value={c.guess.category}
                                    onChange={(e) =>
                                      setGuess(s.letter, {
                                        category: e.target
                                          .value as FeederGuess["category"],
                                      })
                                    }
                                    className={input}
                                  >
                                    {CATEGORIES.map((x) => (
                                      <option key={x}>{x}</option>
                                    ))}
                                  </select>
                                  <select
                                    value={c.guess.deviceType ?? ""}
                                    onChange={(e) =>
                                      setGuess(s.letter, {
                                        deviceType: (e.target.value ||
                                          null) as Feeder["device_type"],
                                      })
                                    }
                                    className={input}
                                  >
                                    <option value="">Device…</option>
                                    {DEVICES.map((x) => (
                                      <option key={x}>{x}</option>
                                    ))}
                                  </select>
                                  <input
                                    value={c.guess.ratedCurrent ?? ""}
                                    onKeyDown={numericKeyGuard()}
                                    onChange={(e) =>
                                      setGuess(s.letter, {
                                        ratedCurrent: e.target.value
                                          ? Number(e.target.value)
                                          : null,
                                      })
                                    }
                                    placeholder="A"
                                    className={`${input} w-16 text-right`}
                                    title="Rated current (A)"
                                  />
                                  <select
                                    value={c.guess.poles ?? ""}
                                    onChange={(e) =>
                                      setGuess(s.letter, {
                                        poles: (e.target.value ||
                                          null) as FeederGuess["poles"],
                                      })
                                    }
                                    className={input}
                                  >
                                    <option value="">Poles…</option>
                                    <option value="3-Pole (3P)">3P</option>
                                    <option value="4-Pole (4P)">4P</option>
                                  </select>
                                </div>
                              )}
                              {c.action === "merge" && (
                                <select
                                  value={c.target ?? ""}
                                  onChange={(e) =>
                                    setChoice(s.letter, {
                                      target: e.target.value || null,
                                    })
                                  }
                                  className={`${input} ${c.target ? "" : "border-error text-error"}`}
                                >
                                  <option value="">Choose a feeder…</option>
                                  {feederOptions
                                    .filter((o) => o.letter !== s.letter)
                                    .map((o) => (
                                      <option key={o.letter} value={o.letter}>
                                        {o.letter} · {o.guess.name}
                                      </option>
                                    ))}
                                </select>
                              )}
                              {c.action === "skip" && s.kind === "busbar" && (
                                <span className="text-[11px] text-on-surface-variant">
                                  Busbars come from the GA busbar plan.
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-on-surface-variant">
                    Quantities are divided by the feeder qty. A merged item
                    that doesn&apos;t divide evenly by the target feeder&apos;s
                    qty has its remainder moved to another feeder that takes it
                    in whole numbers.
                    {busbarText
                      ? " The busbar list sheet will be added to the busbar section's remarks."
                      : ""}
                  </p>
                  {problems.length > 0 && (
                    <ul className="ml-4 list-disc text-xs text-error">
                      {problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {stage === "items" && (
                <div className="space-y-4">
                  {missing.length > 0 && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-3">
                      <p className="mb-2 text-xs font-semibold text-amber-900">
                        {missing.length} item(s) aren&apos;t in Item Master.
                        Create them (fields filled in from the sheet), point
                        to an existing item code, or leave them out.
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-[11px]">
                          <thead className="text-left uppercase text-secondary">
                            <tr>
                              <th className="py-1 pr-1">Do</th>
                              <th className="py-1 pr-1">SKU / Part no.</th>
                              <th className="py-1 pr-1">Vendor cat</th>
                              <th className="py-1 pr-1">Description</th>
                              <th className="py-1 pr-1">Make</th>
                              <th className="py-1 pr-1">Category</th>
                              <th className="py-1 pr-1">Source</th>
                              <th className="py-1 pr-1">Unit</th>
                              <th className="py-1 pr-1">Cost</th>
                              <th className="py-1">A / P / kA / frame</th>
                            </tr>
                          </thead>
                          <tbody>
                            {missing.map((r) => {
                              const done = !!itemFor(r.lineKey, null);
                              const brk = isBreakerCategory(r.category);
                              return (
                                <tr
                                  key={r.lineKey}
                                  className="border-t border-amber-200 align-top"
                                >
                                  <td className="py-1 pr-1">
                                    <select
                                      value={r.mode}
                                      disabled={done && r.mode === "create"}
                                      onChange={(e) =>
                                        patchMissing(r.lineKey, {
                                          mode: e.target.value as MissingRow["mode"],
                                        })
                                      }
                                      className={input}
                                    >
                                      <option value="create">Create</option>
                                      <option value="existing">Use code…</option>
                                      <option value="skip">Leave out</option>
                                    </select>
                                    {done && (
                                      <span className="ml-1 text-emerald-700">
                                        ✓
                                      </span>
                                    )}
                                  </td>
                                  {r.mode === "existing" ? (
                                    <td colSpan={9} className="py-1">
                                      <input
                                        value={r.existingCode}
                                        onChange={(e) =>
                                          patchMissing(r.lineKey, {
                                            existingCode: e.target.value,
                                          })
                                        }
                                        placeholder="Existing SKU or vendor cat"
                                        className={`${input} w-48`}
                                      />{" "}
                                      {r.existingCode.trim() &&
                                        (bySku.get(
                                          r.existingCode.trim().toUpperCase(),
                                        ) ? (
                                          <span className="text-emerald-700">
                                            {
                                              bySku.get(
                                                r.existingCode
                                                  .trim()
                                                  .toUpperCase(),
                                              )!.description
                                            }
                                          </span>
                                        ) : (
                                          <span className="text-error">
                                            Not found
                                          </span>
                                        ))}
                                      <span className="ml-2 text-on-surface-variant">
                                        for: {r.description}
                                      </span>
                                    </td>
                                  ) : (
                                    <>
                                      <td className="py-1 pr-1">
                                        <input
                                          value={r.sku}
                                          disabled={r.mode === "skip" || done}
                                          onChange={(e) =>
                                            patchMissing(r.lineKey, {
                                              sku: e.target.value,
                                            })
                                          }
                                          className={`${input} w-28`}
                                        />
                                      </td>
                                      <td className="py-1 pr-1">
                                        <input
                                          value={r.vendorCat}
                                          disabled={r.mode === "skip" || done}
                                          onChange={(e) =>
                                            patchMissing(r.lineKey, {
                                              vendorCat: e.target.value,
                                            })
                                          }
                                          className={`${input} w-28`}
                                        />
                                      </td>
                                      <td className="py-1 pr-1">
                                        <textarea
                                          value={r.description}
                                          disabled={r.mode === "skip" || done}
                                          rows={2}
                                          onChange={(e) =>
                                            patchMissing(r.lineKey, {
                                              description: e.target.value,
                                            })
                                          }
                                          className={`${input} w-64`}
                                        />
                                        {r.error && (
                                          <p className="text-error">{r.error}</p>
                                        )}
                                      </td>
                                      <td className="py-1 pr-1">
                                        <input
                                          value={r.make}
                                          disabled={r.mode === "skip" || done}
                                          onChange={(e) =>
                                            patchMissing(r.lineKey, {
                                              make: e.target.value,
                                            })
                                          }
                                          className={`${input} w-20`}
                                        />
                                      </td>
                                      <td className="py-1 pr-1">
                                        <input
                                          list="pk-categories"
                                          value={r.category}
                                          disabled={r.mode === "skip" || done}
                                          onChange={(e) =>
                                            patchMissing(r.lineKey, {
                                              category: e.target.value,
                                            })
                                          }
                                          className={`${input} w-28`}
                                        />
                                      </td>
                                      <td className="py-1 pr-1">
                                        <select
                                          value={r.source}
                                          disabled={r.mode === "skip" || done}
                                          onChange={(e) =>
                                            patchMissing(r.lineKey, {
                                              source: e.target.value as ItemSource,
                                            })
                                          }
                                          className={input}
                                        >
                                          <option value="">—</option>
                                          <option>Design</option>
                                          <option>Estimation</option>
                                        </select>
                                      </td>
                                      <td className="py-1 pr-1">
                                        <input
                                          value={r.uom ?? ""}
                                          disabled={r.mode === "skip" || done}
                                          onChange={(e) =>
                                            patchMissing(r.lineKey, {
                                              uom: e.target.value,
                                            })
                                          }
                                          className={`${input} w-14`}
                                        />
                                      </td>
                                      <td className="py-1 pr-1">
                                        <input
                                          value={r.unitCost}
                                          disabled={r.mode === "skip" || done}
                                          onKeyDown={numericKeyGuard()}
                                          onChange={(e) =>
                                            patchMissing(r.lineKey, {
                                              unitCost: e.target.value,
                                            })
                                          }
                                          className={`${input} w-16 text-right`}
                                        />
                                      </td>
                                      <td className="py-1">
                                        {brk && (
                                          <div className="flex gap-0.5">
                                            {(["amps", "poles", "ka"] as const).map(
                                              (k) => (
                                                <input
                                                  key={k}
                                                  value={r[k]}
                                                  placeholder={k}
                                                  disabled={done}
                                                  onKeyDown={numericKeyGuard()}
                                                  onChange={(e) =>
                                                    patchMissing(r.lineKey, {
                                                      [k]: e.target.value,
                                                    })
                                                  }
                                                  className={`${input} w-12`}
                                                />
                                              ),
                                            )}
                                            {isFrameRequiredCategory(
                                              r.category,
                                            ) && (
                                              <input
                                                value={r.frame}
                                                placeholder="frame"
                                                disabled={done}
                                                onChange={(e) =>
                                                  patchMissing(r.lineKey, {
                                                    frame: e.target.value,
                                                  })
                                                }
                                                className={`${input} w-14`}
                                              />
                                            )}
                                          </div>
                                        )}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <datalist id="pk-categories">
                          {categories.map((c) => (
                            <option key={c} value={c} />
                          ))}
                        </datalist>
                      </div>
                      {toCreate.length > 0 && (
                        <button
                          onClick={createItems}
                          className="btn btn-primary btn-sm mt-2"
                        >
                          <Icon name="add_circle" size={14} /> Create{" "}
                          {toCreate.length} item(s) in Item Master
                        </button>
                      )}
                    </div>
                  )}

                  <div className="space-y-1">
                    {plan.map((f) => {
                      const flagged = f.lines.filter((l) => l.flags.length);
                      const isOpen = openFeeder === f.letter;
                      return (
                        <div
                          key={f.letter}
                          className="rounded-lg border border-surface-container-high"
                        >
                          <button
                            onClick={() => setOpenFeeder(isOpen ? null : f.letter)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                          >
                            <Icon
                              name={isOpen ? "expand_less" : "expand_more"}
                              size={16}
                            />
                            <b>{f.letter}</b> {f.guess.name}
                            <span className="text-on-surface-variant">
                              × {f.qty} · {f.lines.length} lines
                            </span>
                            {flagged.length > 0 && (
                              <span className="ml-auto rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">
                                {flagged.length} to check
                              </span>
                            )}
                          </button>
                          {isOpen && (
                            <table className="w-full border-collapse text-[11px]">
                              <thead className="text-left uppercase text-secondary">
                                <tr className="border-t border-surface-container">
                                  <th className="px-3 py-1">Item</th>
                                  <th className="px-2 py-1">Description</th>
                                  <th className="px-2 py-1 text-right">
                                    Qty / feeder
                                  </th>
                                  <th className="px-2 py-1">Note</th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.lines.map((l) => {
                                  const it = itemFor(l.key, l.partNo);
                                  const out = skipped(l.key);
                                  return (
                                    <tr
                                      key={l.key}
                                      className={`border-t border-surface-container ${out ? "opacity-40" : ""}`}
                                    >
                                      <td className="px-3 py-1 font-mono">
                                        {it ? (
                                          itemCode(it)
                                        ) : (
                                          <span className="text-error">
                                            {out ? "left out" : (l.partNo ?? "no part no.")}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-2 py-1">
                                        {l.description}
                                      </td>
                                      <td className="px-2 py-1 text-right">
                                        <input
                                          value={qtyOf(f.letter, l.key, l.perFeeder)}
                                          onKeyDown={numericKeyGuard()}
                                          onChange={(e) =>
                                            setQtyEdits((m) =>
                                              new Map(m).set(
                                                `${f.letter}|${l.key}`,
                                                Number(e.target.value) || 0,
                                              ),
                                            )
                                          }
                                          className={`${input} w-16 text-right ${l.flags.includes("fraction") ? "border-amber-500 bg-amber-50" : ""}`}
                                        />{" "}
                                        {l.unit}
                                      </td>
                                      <td className="px-2 py-1 text-on-surface-variant">
                                        {l.flags.includes("fraction") &&
                                          "Doesn't divide evenly — check. "}
                                        {l.flags.includes("spread") &&
                                          "Part of a merged qty (rest on another feeder). "}
                                        {l.from.some((x) => x !== f.letter) &&
                                          `From ${l.from.filter((x) => x !== f.letter).join(", ")}.`}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {stage === "done" && (
                <p className="text-sm text-on-surface">{result}</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-surface-container-high px-5 py-3">
              <div className="text-[11px] text-on-surface-variant">
                {stage === "items" &&
                  (unresolved.length
                    ? `${unresolved.length} line(s) still need an item (create it, use a code, or leave it out).`
                    : `${plan.length} feeder(s) ready.`)}
              </div>
              <div className="flex gap-2">
                {stage === "sections" && (
                  <button onClick={reset} className="btn btn-outline btn-sm">
                    Back
                  </button>
                )}
                {stage === "items" && (
                  <button
                    onClick={() => setStage("sections")}
                    className="btn btn-outline btn-sm"
                  >
                    Back
                  </button>
                )}
                {stage === "sections" && (
                  <button onClick={toItems} className="btn btn-primary btn-sm">
                    Next: items
                  </button>
                )}
                {stage === "items" && (
                  <button
                    onClick={runImport}
                    disabled={unresolved.length > 0}
                    className="btn btn-primary btn-sm disabled:opacity-50"
                  >
                    Import {plan.length} feeder(s)
                  </button>
                )}
                {stage === "done" && (
                  <button onClick={close} className="btn btn-primary btn-sm">
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
