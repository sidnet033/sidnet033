"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";

// Searchable dropdown over a list of existing values, with "Add <typed>"
// for a value that isn't in the list yet.
export function ValuePicker({
  value,
  options,
  onChange,
  placeholder = "Select...",
  numeric = false,
  invalid = false,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
  invalid?: boolean;
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
  const matches = q
    ? options.filter((o) => o.toLowerCase().includes(q))
    : options;
  const typed = search.trim();
  const exact = options.some((o) => o.toLowerCase() === q);
  const typedOk = !numeric || (typed !== "" && !Number.isNaN(Number(typed)));

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-1 rounded-[4px] border px-2 py-1.5 text-left text-sm ${invalid ? "border-error/60" : "border-outline-variant/60"}`}
      >
        <span
          className={`truncate ${value ? "text-on-surface" : "text-secondary"}`}
        >
          {value || placeholder}
        </span>
        <Icon
          name={open ? "expand_less" : "expand_more"}
          size={15}
          className="shrink-0 text-secondary"
        />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-48 rounded-md border border-outline-variant/60 bg-surface-container-lowest shadow-md">
          <input
            autoFocus
            value={search}
            inputMode={numeric ? "decimal" : undefined}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (matches.length === 1) pick(matches[0]);
                else if (typed && !exact && typedOk) pick(typed);
              }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={
              numeric
                ? "Search or type a new value..."
                : "Search or type a new name..."
            }
            className="w-full border-b border-outline-variant/40 px-2 py-1.5 text-sm focus:outline-none"
          />
          <div className="max-h-52 overflow-y-auto">
            {value && (
              <button
                type="button"
                onClick={() => pick("")}
                className="block w-full px-2 py-1 text-left text-xs text-secondary hover:bg-surface-container-low"
              >
                Clear selection
              </button>
            )}
            {matches.map((o) => (
              <button
                type="button"
                key={o}
                onClick={() => pick(o)}
                className={`block w-full px-2 py-1 text-left text-sm hover:bg-surface-container-low ${o === value ? "font-bold text-primary" : ""}`}
              >
                {o}
              </button>
            ))}
            {matches.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-secondary">No matches.</p>
            )}
          </div>
          {typed && !exact && (
            <button
              type="button"
              disabled={!typedOk}
              onClick={() => pick(typed)}
              className="flex w-full items-center gap-1 border-t border-outline-variant/40 px-2 py-1.5 text-left text-xs font-bold text-primary hover:bg-primary/5 disabled:text-secondary"
            >
              <Icon name="add" size={13} />{" "}
              {typedOk ? `Add "${typed}"` : "Type a number"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
