import type { KeyboardEvent } from "react";

// Use type="text" + inputMode="decimal" + this guard instead of
// type="number" everywhere numeric entry is needed. Chromium (and other
// browsers) don't select a type="number" field's whole value on
// double-click the way they do for a text field -- only Ctrl+A or
// triple-click actually select all -- so double-clicking a number cell to
// overwrite it silently inserts the typed digit instead of replacing the
// content. Swapping to a plain text field restores normal selection
// behavior; this guard blocks non-numeric keystrokes to keep the same
// numbers-only typing experience.
const NAVIGATION_KEYS = ["Backspace", "Delete", "Tab", "Escape", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];

export function numericKeyGuard(allowNegative = false) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (NAVIGATION_KEYS.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) return;
    if (e.key === "." && !e.currentTarget.value.includes(".")) return;
    if (allowNegative && e.key === "-" && e.currentTarget.selectionStart === 0 && !e.currentTarget.value.startsWith("-")) return;
    e.preventDefault();
  };
}

// Excel-style movement between the numeric cells of one table. Each input
// carries data-row / data-col and sits inside an element with data-grid.
// Up/Down (and Enter / Shift+Enter) move to the same column one row
// down/up; Left/Right move to the neighbouring column once the caret is
// already at that edge of the text (or the whole value is selected), so
// they still move the caret while editing. The cell landed on has its
// value selected, so typing replaces it.
export function gridKeyNav(e: KeyboardEvent<HTMLInputElement>): boolean {
  const el = e.currentTarget;
  const row = Number(el.dataset.row);
  const col = Number(el.dataset.col);
  const grid = el.closest("[data-grid]");
  if (!grid || Number.isNaN(row) || Number.isNaN(col) || e.ctrlKey || e.metaKey || e.altKey) return false;

  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const allSelected = start === 0 && end === el.value.length;
  let target: [number, number] | null = null;
  if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) target = [row - 1, col];
  else if (e.key === "ArrowDown" || e.key === "Enter") target = [row + 1, col];
  else if (e.key === "ArrowLeft" && (allSelected || (start === 0 && end === 0))) target = [row, col - 1];
  else if (e.key === "ArrowRight" && (allSelected || (start === el.value.length && end === el.value.length))) target = [row, col + 1];
  if (!target) return false;

  const next = grid.querySelector<HTMLInputElement>(`input[data-row="${target[0]}"][data-col="${target[1]}"]`);
  e.preventDefault();
  if (next) {
    next.focus();
    next.select();
  }
  return true;
}

// numericKeyGuard + gridKeyNav for numeric cells that belong to a grid.
export function numericGridKeys(allowNegative = false) {
  const guard = numericKeyGuard(allowNegative);
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (gridKeyNav(e)) return;
    guard(e);
  };
}
