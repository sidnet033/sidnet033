"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import type { ReviewItem } from "@/lib/project-impact";

const SEVERITY_STYLE: Record<ReviewItem["severity"], { dot: string; label: string }> = {
  alert: { dot: "bg-error", label: "Alert — blocks saving" },
  warning: { dot: "bg-amber-500", label: "Warning — saving allowed" },
  change: { dot: "bg-primary", label: "Change" },
};

function groupItems(items: ReviewItem[]) {
  const groups: { key: string; title: string; switchboardId: string; items: ReviewItem[] }[] = [];
  for (const item of items) {
    const key = `${item.revisionLabel}|${item.switchboardId}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, title: `${item.revisionLabel} — ${item.boardLabel}`, switchboardId: item.switchboardId, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }
  return groups;
}

export function isTickable(item: ReviewItem): boolean {
  return !item.blockedReason && (item.apply != null || item.keep != null);
}

// Review lines whose current tick state would leave an alert behind -- the
// save can't be approved while any remain.
export function unresolvedAlerts(items: ReviewItem[], ticked: Set<string>): ReviewItem[] {
  return items.filter((i) => {
    if (i.severity === "alert") return !(i.apply && !i.blockedReason && ticked.has(i.id));
    if (i.keepSeverity === "alert") return !ticked.has(i.id) && !i.blockedReason;
    return false;
  });
}

function reviewHint(item: ReviewItem, ticked: boolean, tickable: boolean): { text: string; error: boolean } {
  if (item.blockedReason) return { text: item.blockedReason, error: item.severity === "alert" };
  if (item.severity === "alert") {
    if (!tickable) return { text: "Must be fixed before saving — cancel and fix it where the message says.", error: true };
    return ticked
      ? { text: `Will apply: ${item.applyLabel ?? "fix"}.`, error: false }
      : { text: "Unticked, this stays an alert — tick it or cancel; the save can't go ahead with it.", error: true };
  }
  if (item.keep) {
    if (ticked) return { text: `Will apply: ${item.applyLabel ?? "change"}.`, error: false };
    return item.keepSeverity === "alert"
      ? { text: "Unticked keeps the current bar, which would then be undersized — an alert, so the save can't go ahead.", error: true }
      : { text: "Unticked keeps the current size (listed under Warnings afterward).", error: false };
  }
  if (!tickable) return { text: "Warning only — you can still save.", error: false };
  return ticked
    ? { text: `Will apply: ${item.applyLabel ?? "fix"}.`, error: false }
    : { text: "Unticked: left as is (listed under Warnings) — you can still save.", error: false };
}

// Grouped by revision + switchboard. A checkbox only appears where ticking
// actually does something; manual-fix lines say where to go instead.
function ItemList({
  items,
  ticked,
  onToggle,
  onOpenBoard,
  mode,
}: {
  items: ReviewItem[];
  ticked: Set<string>;
  onToggle: (id: string) => void;
  onOpenBoard?: (switchboardId: string) => void;
  mode: "review" | "alerts";
}) {
  return (
    <div className="space-y-space-md">
      {groupItems(items).map((g) => (
        <div key={g.key} className="overflow-hidden rounded-lg border border-surface-container-high">
          <div className="flex items-center justify-between bg-surface-container-low px-space-md py-space-sm">
            <span className="font-label-md text-label-md text-on-surface">{g.title}</span>
            {onOpenBoard && (
              <button onClick={() => onOpenBoard(g.switchboardId)} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                Open GA <Icon name="open_in_new" size={14} />
              </button>
            )}
          </div>
          <ul className="divide-y divide-surface-container-high">
            {g.items.map((item) => {
              const tickable = isTickable(item);
              const style = SEVERITY_STYLE[item.severity];
              const hint =
                mode === "review"
                  ? reviewHint(item, ticked.has(item.id), tickable)
                  : {
                      text:
                        item.blockedReason ??
                        (tickable ? `Fix: ${item.applyLabel ?? "apply"}` : item.severity === "alert" ? "Needs a manual fix." : "Check this — saving is still allowed."),
                      error: false,
                    };
              return (
                <li key={item.id} className="flex items-start gap-space-sm px-space-md py-space-sm">
                  <span className="mt-0.5 w-4 shrink-0">
                    {tickable && (
                      <input
                        type="checkbox"
                        checked={ticked.has(item.id)}
                        onChange={() => onToggle(item.id)}
                        className="h-4 w-4 cursor-pointer accent-primary"
                        aria-label={item.message}
                      />
                    )}
                  </span>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} title={style.label} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="rounded bg-surface-container px-1.5 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">{item.area}</span>
                      <span className="text-sm text-on-surface">{item.message}</span>
                    </div>
                    <div className={`mt-0.5 text-xs ${hint.error ? "font-medium text-error" : "text-secondary"}`}>{hint.text}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function ImpactReviewDialog({
  items,
  onApprove,
  onCancel,
}: {
  items: ReviewItem[];
  onApprove: (ticked: Set<string>) => void;
  onCancel: () => void;
}) {
  const [ticked, setTicked] = useState(() => new Set(items.filter(isTickable).map((i) => i.id)));
  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const tickable = items.filter(isTickable);
  const boards = new Set(items.map((i) => i.switchboardId)).size;
  const blocking = unresolvedAlerts(items, ticked);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-space-md backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl">
        <div className="border-b border-surface-container-high px-space-lg py-space-md">
          <h2 className="font-headline-md text-headline-md text-on-surface">Review changes before saving</h2>
          <p className="mt-1 text-sm text-secondary">
            This change affects {items.length} item{items.length === 1 ? "" : "s"} across {boards} switchboard{boards === 1 ? "" : "s"}. Tick what you want
            applied. <span className="text-error">Alerts</span> must be fixed to save; <span className="text-amber-600">warnings</span> can be left as they are.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-space-lg">
          <ItemList items={items} ticked={ticked} onToggle={toggle} mode="review" />
        </div>
        <div className="flex items-center justify-between gap-space-sm border-t border-surface-container-high px-space-lg py-space-md">
          <div className="flex gap-space-sm text-xs">
            <button onClick={() => setTicked(new Set(tickable.map((i) => i.id)))} className="text-primary hover:underline">
              Tick all
            </button>
            <button onClick={() => setTicked(new Set())} className="text-primary hover:underline">
              Untick all
            </button>
          </div>
          <div className="flex items-center gap-space-sm">
            {blocking.length > 0 && (
              <span className="text-xs font-medium text-error">
                {blocking.length} alert{blocking.length === 1 ? "" : "s"} left — can&apos;t save
              </span>
            )}
            <button onClick={onCancel} className="rounded bg-surface-container-low px-space-lg py-space-sm font-label-md text-label-md text-on-surface">
              Cancel
            </button>
            <button
              onClick={() => onApprove(ticked)}
              disabled={blocking.length > 0}
              className="flex items-center gap-1 rounded bg-primary px-space-lg py-space-sm font-label-md text-label-md text-on-primary shadow-sm hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="check" size={16} /> Approve &amp; Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Standing list of what's wrong across the project's live revisions:
// alerts (block saving the revision they're in) above warnings (saving
// allowed). Fixable lines can be ticked and applied straight from here.
export function AlertsPanel({
  items,
  loading,
  readOnly,
  applying,
  onApply,
  onOpenBoard,
}: {
  items: ReviewItem[];
  loading: boolean;
  readOnly: boolean;
  applying: boolean;
  onApply: (ids: Set<string>) => void;
  onOpenBoard: ((switchboardId: string) => void) | undefined;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  if (loading || items.length === 0) return null;

  const alerts = items.filter((i) => i.severity === "alert");
  const warnings = items.filter((i) => i.severity !== "alert");
  const fixable = items.filter((i) => i.apply && !i.blockedReason);
  const selected = fixable.filter((i) => ticked.has(i.id));
  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // checkboxes here only ever apply a fix -- there's no "keep" to choose
  const shown = (list: ReviewItem[]) => list.map((i) => ({ ...i, keep: null, apply: readOnly ? null : i.apply }));

  return (
    <div className={`overflow-hidden rounded-xl border bg-surface-container-lowest shadow-sm ${alerts.length > 0 ? "border-error/30" : "border-amber-300/60"}`}>
      <button onClick={() => setCollapsed((v) => !v)} className="flex w-full items-center justify-between p-space-lg text-left">
        <span className="flex flex-wrap items-center gap-2">
          <Icon name={alerts.length > 0 ? "error" : "warning"} size={20} className={alerts.length > 0 ? "text-error" : "text-amber-600"} />
          <span className="font-headline-md text-headline-md text-on-surface">Alerts &amp; Warnings</span>
          {alerts.length > 0 && (
            <span className="rounded-full bg-error/10 px-2 py-0.5 text-xs font-bold text-error">
              {alerts.length} alert{alerts.length === 1 ? "" : "s"}
            </span>
          )}
          {warnings.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
              {warnings.length} warning{warnings.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="font-body-sm text-body-sm font-normal text-secondary">
            {alerts.length > 0 ? "Alerts must be fixed before the revision they're in can be saved." : "Warnings don't stop you saving."}
          </span>
        </span>
        <Icon name={collapsed ? "expand_more" : "expand_less"} size={18} />
      </button>
      {!collapsed && (
        <div className="space-y-space-md border-t border-surface-container-high p-space-lg">
          {alerts.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-error">Alerts — block saving</p>
              <ItemList items={shown(alerts)} ticked={ticked} onToggle={toggle} onOpenBoard={onOpenBoard} mode="alerts" />
            </div>
          )}
          {warnings.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-700">Warnings — saving allowed</p>
              <ItemList items={shown(warnings)} ticked={ticked} onToggle={toggle} onOpenBoard={onOpenBoard} mode="alerts" />
            </div>
          )}
          {!readOnly && fixable.length > 0 && (
            <div className="flex items-center justify-between">
              <button onClick={() => setTicked(new Set(fixable.map((i) => i.id)))} className="text-xs text-primary hover:underline">
                Tick all fixable ({fixable.length})
              </button>
              <button
                onClick={() => {
                  onApply(new Set(selected.map((i) => i.id)));
                  setTicked(new Set());
                }}
                disabled={selected.length === 0 || applying}
                className="flex items-center gap-1 rounded bg-primary px-space-lg py-space-sm font-label-md text-label-md text-on-primary shadow-sm hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="build" size={16} /> {applying ? "Applying..." : `Apply selected fixes (${selected.length})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
