"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";

// "All" button + a dropdown of every category with checkboxes (searchable).
// An empty selection means all categories.
export function CategoryFilter({
  categories,
  selected,
  onChange,
}: {
  categories: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = search.trim().toLowerCase();
  const shown = q
    ? categories.filter((c) => c.toLowerCase().includes(q))
    : categories;
  const all = selected.size === 0;
  const label = all
    ? "Select categories"
    : selected.size === 1
      ? [...selected][0]
      : `${selected.size} categories`;

  function toggle(c: string) {
    const next = new Set(selected);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    onChange(next);
  }

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <button
        type="button"
        onClick={() => onChange(new Set())}
        className={`shrink-0 rounded-full px-2.5 py-0.5 transition-colors ${
          all
            ? "bg-primary font-semibold text-on-primary"
            : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
        }`}
      >
        All
      </button>
      <div ref={boxRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 ${
            all
              ? "border-surface-container-high text-on-surface-variant"
              : "border-primary bg-primary/10 font-semibold text-primary"
          }`}
        >
          <span className="max-w-48 truncate">{label}</span>
          <Icon name={open ? "expand_less" : "expand_more"} size={14} />
        </button>
        {open && (
          <div className="absolute left-0 z-40 mt-1 w-64 rounded-md border border-surface-container-high bg-surface-container-lowest shadow-md">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories..."
              className="w-full border-b border-surface-container px-2.5 py-1.5 text-xs focus:outline-none"
            />
            <div className="max-h-60 overflow-y-auto py-1">
              {shown.map((c) => (
                <label
                  key={c}
                  className="flex cursor-pointer items-center gap-2 px-2.5 py-1 hover:bg-surface-container-low"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c)}
                    onChange={() => toggle(c)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="truncate">{c}</span>
                </label>
              ))}
              {shown.length === 0 && (
                <p className="px-2.5 py-1.5 text-secondary">
                  No matching categories.
                </p>
              )}
            </div>
            {!all && (
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="w-full border-t border-surface-container px-2.5 py-1.5 text-left font-bold text-primary hover:bg-primary/5"
              >
                Clear ({selected.size})
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
