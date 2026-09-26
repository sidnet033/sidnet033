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
