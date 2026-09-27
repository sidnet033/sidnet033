"use client";

import { useRef, useState } from "react";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";
import { SavingOverlay } from "@/components/saving-overlay";
import { numericKeyGuard } from "@/lib/numeric-input";
import {
  TEMPLATE_COLUMNS,
  buildItemIndex,
  buildMissingItemDrafts,
  classifyGroups,
  createMissingItems,
  executeImport,
  fetchExtendContext,
  findMissingItems,
  groupFeederLines,
  logFeederImport,
  parseFeederSheet,
  planImport,
  validateMissingDraft,
  type ClassifiedGroup,
  type FeederImportSummary,
  type ImportPlan,
  type MissingItemDraft,
  type RowError,
} from "@/lib/feeder-import";
import type { Feeder, ItemMaster, ItemSource } from "@/types/database";

type Stage = "landing" | "reading" | "missing" | "creating" | "confirm" | "importing" | "done" | "error";

export function FeederImportDialog({
  feeders,
  items,
  currentUserName,
  onDone,
}: {
  feeders: Feeder[];
  items: ItemMaster[];
  currentUserName?: string;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("landing");
  const [fileName, setFileName] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const [classified, setClassified] = useState<ClassifiedGroup[]>([]);
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [drafts, setDrafts] = useState<MissingItemDraft[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [itemsCreatedCount, setItemsCreatedCount] = useState(0);

  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [summary, setSummary] = useState<FeederImportSummary | null>(null);

  function reset() {
    setOpen(false);
    setStage("landing");
    setFileName("");
    setErrorText(null);
    setClassified([]);
    setRowErrors([]);
    setDrafts([]);
    setDraftError(null);
    setItemsCreatedCount(0);
    setPlan(null);
    setSummary(null);
  }

  async function proceedToConfirm(groups: ClassifiedGroup[], newlyCreatedItems: ItemMaster[]) {
    const supabase = createClient();
    const index = buildItemIndex([...items, ...newlyCreatedItems]);
    const extendFeederIds = groups.filter((g) => g.mode === "extend").map((g) => g.existingFeeder!.id);
    const { itemIdsByFeederId, nextSortOrderByFeederId } = await fetchExtendContext(supabase, extendFeederIds);
    setPlan(planImport(groups, index, itemIdsByFeederId, nextSortOrderByFeederId));
    setStage("confirm");
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setStage("reading");
    setErrorText(null);

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) {
        setErrorText("No sheet found in that file.");
        setStage("error");
        return;
      }

      const { lines, rowErrors: parseErrors } = parseFeederSheet(sheet);
      if (lines.length === 0 && parseErrors.length === 0) {
        setErrorText("No data rows found in the sheet.");
        setStage("error");
        return;
      }

      const groups = classifyGroups(groupFeederLines(lines), feeders);
      const index = buildItemIndex(items);
      const missing = findMissingItems(groups, index);

      setClassified(groups);
      setRowErrors(parseErrors);

      if (missing.length > 0) {
        setDrafts(buildMissingItemDrafts(missing));
        setStage("missing");
      } else {
        await proceedToConfirm(groups, []);
      }
    } catch {
      setErrorText("Could not read that file. Make sure it's a .xlsx file.");
      setStage("error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function patchDraft(key: string, p: Partial<MissingItemDraft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...p } : d)));
  }

  async function handleContinueFromMissing() {
    for (const d of drafts) {
      if (!d.create) continue;
      const err = validateMissingDraft(d);
      if (err) {
        setDraftError(`${d.sku || d.vendorCat || "(a row)"}: ${err}`);
        return;
      }
    }
    setDraftError(null);
    setStage("creating");
    const supabase = createClient();
    const { created, errors } = await createMissingItems(supabase, drafts);
    setItemsCreatedCount(created.length);
    if (errors.length > 0) {
      setDraftError(`${errors.length} item(s) could not be created; their lines will be skipped. First: ${errors[0].reason}`);
    }
    await proceedToConfirm(classified, created);
  }

  async function handleProceed() {
    if (!plan) return;
    setStage("importing");
    const supabase = createClient();
    const result = await executeImport(supabase, plan, feeders);
    await logFeederImport(supabase, {
      fileName,
      itemsCreated: itemsCreatedCount,
      summary: result,
      importedByName: currentUserName ?? null,
    });
    setSummary(result);
    setStage("done");
    if (result.feedersCreated > 0 || result.feedersExtended > 0 || itemsCreatedCount > 0) onDone();
  }

  async function downloadFailedRows() {
    if (!summary) return;
    const failed = [...rowErrors, ...summary.failedRows];
    if (failed.length === 0) return;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Feeders");
    sheet.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c, key: c, width: 18 }));
    for (const f of failed) sheet.addRow(f.raw);
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "feeder-import-failed-rows.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalFeeders = classified.length;
  const newCount = classified.filter((g) => g.mode === "create").length;
  const extendCount = classified.filter((g) => g.mode === "extend").length;
  const totalLines = classified.reduce((s, g) => s + g.lines.length, 0);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-space-xs rounded bg-surface-container-lowest px-space-md py-space-sm font-body-md text-body-md text-on-surface shadow-sm hover:bg-surface-container-low"
      >
        <Icon name="input" size={18} /> Import Feeder XLS
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4 backdrop-blur-sm" onClick={stage === "landing" || stage === "error" ? reset : undefined}>
          <SavingOverlay show={stage === "creating" || stage === "importing"} label={stage === "creating" ? "Creating items..." : "Importing feeders..."} />
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-[8px] bg-surface-container-lowest shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-outline-variant/30 p-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary-container text-on-primary-container">
                  <Icon name="input" size={20} />
                </div>
                <div>
                  <h2 className="font-display text-sm font-semibold text-on-surface">Import Feeder XLS</h2>
                  {fileName && <p className="text-xs text-secondary">{fileName}</p>}
                </div>
              </div>
              <button onClick={reset} className="rounded p-1 text-secondary hover:bg-surface-container-low hover:text-on-surface">
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="overflow-y-auto p-4">
              {stage === "landing" && (
                <div className="space-y-4">
                  <p className="text-sm text-on-surface-variant">
                    Upload a feeder list to create new library feeders, and add new BOM lines to feeders that already exist. Feeders
                    aren&rsquo;t edited or overwritten — only new items and new lines get added.
                  </p>
                  <div className="flex items-center gap-3">
                    <a
                      href="/templates/feeder-master-template.xlsx"
                      download
                      className="flex items-center gap-1.5 rounded-[4px] border border-outline-variant/60 px-3 py-1.5 text-sm font-medium text-on-surface hover:bg-surface-container-low"
                    >
                      <Icon name="file_download" size={16} /> Download template
                    </a>
                    <label className="flex cursor-pointer items-center gap-1.5 rounded-[4px] bg-primary px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-container">
                      <Icon name="upload_file" size={16} /> Upload file
                      <input ref={inputRef} type="file" accept=".xlsx" onChange={handleFile} className="hidden" />
                    </label>
                  </div>
                </div>
              )}

              {(stage === "reading" || stage === "creating" || stage === "importing") && (
                <p className="py-8 text-center text-sm text-on-surface-variant">
                  {stage === "reading" ? "Reading file..." : stage === "creating" ? "Creating items..." : "Importing feeders..."}
                </p>
              )}

              {stage === "error" && (
                <div className="space-y-3">
                  <p className="text-sm text-error">{errorText}</p>
                  <button onClick={reset} className="rounded-[4px] bg-surface-container-low px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-container-high">
                    Close
                  </button>
                </div>
              )}

              {stage === "missing" && (
                <div className="space-y-4">
                  <div className="rounded-[4px] bg-surface-container-low p-3 text-xs text-on-surface-variant">
                    {totalFeeders} feeder{totalFeeders === 1 ? "" : "s"} ({newCount} new, {extendCount} existing to extend), {totalLines} item
                    line{totalLines === 1 ? "" : "s"}, <span className="font-semibold text-on-surface">{drafts.length} item(s) missing</span>{" "}
                    from Item Master.
                  </div>
                  <p className="text-sm text-on-surface-variant">
                    Fill in the details for the missing items you want to create. Unchecked items won&rsquo;t be created — any feeder line
                    that needs one of them will be skipped (a brand-new feeder needing one is skipped entirely; an existing feeder just won&rsquo;t
                    get that line).
                  </p>
                  <div className="overflow-x-auto rounded-[4px] border border-outline-variant/40">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead className="bg-surface-container text-[10px] font-semibold uppercase tracking-wide text-secondary">
                        <tr className="h-8">
                          <th className="w-8 px-2"></th>
                          <th className="px-2">SKU</th>
                          <th className="px-2">Vendor Cat</th>
                          <th className="px-2">Description *</th>
                          <th className="px-2">Make</th>
                          <th className="px-2">Source *</th>
                          <th className="px-2">Unit Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-container">
                        {drafts.map((d) => (
                          <MissingItemRow key={d.key} draft={d} onChange={(p) => patchDraft(d.key, p)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {draftError && <p className="text-xs text-error">{draftError}</p>}
                  <div className="flex items-center justify-end gap-2 border-t border-outline-variant/30 pt-3">
                    <button onClick={reset} className="rounded-[4px] px-3 py-1.5 text-sm font-medium text-secondary hover:bg-surface-container-low">
                      Cancel
                    </button>
                    <button onClick={handleContinueFromMissing} className="rounded-[4px] bg-primary px-4 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-container">
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {stage === "confirm" && plan && (
                <ConfirmStep plan={plan} itemsCreatedCount={itemsCreatedCount} onCancel={reset} onProceed={handleProceed} />
              )}

              {stage === "done" && summary && (
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="rounded-[4px] bg-tertiary-fixed/50 p-2">
                      <p className="font-display text-lg font-bold text-on-tertiary-fixed">{summary.feedersCreated}</p>
                      <p className="text-[10px] uppercase tracking-wide text-on-tertiary-fixed/80">New feeders</p>
                    </div>
                    <div className="rounded-[4px] bg-secondary-container/60 p-2">
                      <p className="font-display text-lg font-bold text-on-secondary-container">{itemsCreatedCount}</p>
                      <p className="text-[10px] uppercase tracking-wide text-on-secondary-container/80">Items created</p>
                    </div>
                    <div className="rounded-[4px] bg-secondary-container/60 p-2">
                      <p className="font-display text-lg font-bold text-on-secondary-container">
                        {summary.linesAdded}
                        <span className="text-xs font-normal"> / {summary.feedersExtended}f</span>
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-on-secondary-container/80">Lines added</p>
                    </div>
                    <div className="rounded-[4px] bg-error-container p-2">
                      <p className="font-display text-lg font-bold text-on-error-container">{summary.feedersSkipped.length + rowErrors.length}</p>
                      <p className="text-[10px] uppercase tracking-wide text-on-error-container/80">Skipped</p>
                    </div>
                  </div>

                  {(summary.feedersSkipped.length > 0 || rowErrors.length > 0) && (
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-[4px] bg-surface-container-low p-2">
                      {summary.feedersSkipped.map((s, i) => (
                        <p key={`f${i}`} className="text-[11px] text-on-surface-variant">
                          <span className="font-medium text-error">{s.name}:</span> {s.reason}
                        </p>
                      ))}
                      {rowErrors.map((r, i) => (
                        <p key={`r${i}`} className="text-[11px] text-on-surface-variant">
                          <span className="font-medium text-error">Row {r.rowNumber}:</span> {r.reason}
                        </p>
                      ))}
                    </div>
                  )}

                  <p className="text-[11px] text-secondary">Saved to the import audit log.</p>

                  <div className="flex items-center justify-end gap-2">
                    {(summary.failedRows.length > 0 || rowErrors.length > 0) && (
                      <button onClick={downloadFailedRows} className="rounded-[4px] border border-outline-variant/60 px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-container-low">
                        <Icon name="file_download" size={14} className="mr-1 inline" /> Download failed rows
                      </button>
                    )}
                    <button onClick={reset} className="rounded-[4px] bg-primary px-4 py-1.5 text-xs font-medium text-on-primary hover:bg-primary-container">
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ConfirmStep({
  plan,
  itemsCreatedCount,
  onCancel,
  onProceed,
}: {
  plan: ImportPlan;
  itemsCreatedCount: number;
  onCancel: () => void;
  onProceed: () => void;
}) {
  const willCreate = plan.newFeeders.length;
  const blocked = plan.blockedFeeders.length;
  const extensionsWithLines = plan.extensions.filter((e) => e.addLines.length > 0);
  const linesToAdd = plan.extensions.reduce((s, e) => s + e.addLines.length, 0);
  const linesSkipped = plan.extensions.reduce((s, e) => s + e.unresolvedLines.length, 0);

  return (
    <div className="space-y-4">
      {itemsCreatedCount > 0 && <p className="text-sm text-on-surface-variant">{itemsCreatedCount} item(s) created in Item Master.</p>}

      <div className="space-y-2 text-sm">
        <p>
          <span className="font-semibold text-on-surface">{willCreate}</span> new feeder{willCreate === 1 ? "" : "s"} will be created.
        </p>
        {blocked > 0 && (
          <div className="rounded-[4px] bg-error-container/40 p-2">
            <p className="font-medium text-error">{blocked} new feeder(s) will NOT be created — missing item(s):</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-on-surface-variant">
              {plan.blockedFeeders.map((b, i) => (
                <li key={i}>
                  <span className="font-medium">{b.group.displayName}</span> — {b.missingRefs.map((r) => r.sku || r.vendorCat || "?").join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p>
          <span className="font-semibold text-on-surface">{linesToAdd}</span> new line{linesToAdd === 1 ? "" : "s"} will be added to{" "}
          <span className="font-semibold text-on-surface">{extensionsWithLines.length}</span> existing feeder(s) — their own fields and
          existing lines are left untouched.
        </p>
        {linesSkipped > 0 && <p className="text-[11px] text-on-surface-variant">{linesSkipped} line(s) on existing feeders skipped (missing item not created).</p>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-outline-variant/30 pt-3">
        <button onClick={onCancel} className="rounded-[4px] px-3 py-1.5 text-sm font-medium text-secondary hover:bg-surface-container-low">
          Cancel
        </button>
        <button onClick={onProceed} className="rounded-[4px] bg-primary px-4 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-container">
          Proceed
        </button>
      </div>
    </div>
  );
}

function MissingItemRow({ draft, onChange }: { draft: MissingItemDraft; onChange: (p: Partial<MissingItemDraft>) => void }) {
  const effectiveSource: ItemSource | "" = draft.source || (draft.sku.trim() ? "" : "Estimation");
  return (
    <tr className="h-9">
      <td className="px-2">
        <input type="checkbox" checked={draft.create} onChange={(e) => onChange({ create: e.target.checked })} />
      </td>
      <td className="px-2">
        <input
          value={draft.sku}
          onChange={(e) => onChange({ sku: e.target.value })}
          disabled={!draft.create}
          className="w-24 rounded border border-outline-variant/60 px-1.5 py-1 text-xs disabled:opacity-40"
        />
      </td>
      <td className="px-2">
        <input
          value={draft.vendorCat}
          onChange={(e) => onChange({ vendorCat: e.target.value })}
          disabled={!draft.create}
          className="w-24 rounded border border-outline-variant/60 px-1.5 py-1 text-xs disabled:opacity-40"
        />
      </td>
      <td className="px-2">
        <input
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
          disabled={!draft.create}
          placeholder="Required"
          className="w-40 rounded border border-outline-variant/60 px-1.5 py-1 text-xs disabled:opacity-40"
        />
      </td>
      <td className="px-2">
        <input
          value={draft.make}
          onChange={(e) => onChange({ make: e.target.value })}
          disabled={!draft.create}
          className="w-24 rounded border border-outline-variant/60 px-1.5 py-1 text-xs disabled:opacity-40"
        />
      </td>
      <td className="px-2">
        <select
          value={effectiveSource}
          onChange={(e) => onChange({ source: e.target.value as ItemSource })}
          disabled={!draft.create}
          className="rounded border border-outline-variant/60 px-1.5 py-1 text-xs disabled:opacity-40"
        >
          <option value="" disabled>
            Select...
          </option>
          <option value="Design">Design</option>
          <option value="Estimation">Estimation</option>
        </select>
      </td>
      <td className="px-2">
        <input
          type="text"
          inputMode="decimal"
          value={draft.unitCost}
          onChange={(e) => onChange({ unitCost: e.target.value })}
          onKeyDown={numericKeyGuard()}
          disabled={!draft.create}
          className="w-20 rounded border border-outline-variant/60 px-1.5 py-1 text-xs disabled:opacity-40"
        />
      </td>
    </tr>
  );
}
