"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";

const DEFAULT_HELP = (
  <>
    Tick values, or type them separated by <b>|</b> to match <i>any</i> of them
    — e.g. <span className="font-mono">abb|schneider</span> or{" "}
    <span className="font-mono">630|800|1000</span>. Text values match part of
    the name; numbers match exactly.
  </>
);

// A filter value can hold several terms separated by "|": text filters
// (make, category) match values containing any term; number filters
// (amps, poles, kA) match any term exactly.
export function filterTerms(value: string): string[] {
  return value
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function filterHit(
  value: string,
  field: string | number | null,
  kind: "text" | "number",
): boolean {
  const terms = filterTerms(value);
  if (!terms.length) return true;
  if (field == null || field === "") return false;
  const f = String(field).toLowerCase();
  return terms.some((t) =>
    kind === "number"
      ? Number(t) === Number(field)
      : f.includes(t.toLowerCase()),
  );
}

// Filter control: tick values from the list, or type several separated by |
export function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
  className = "",
  help = DEFAULT_HELP,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: string[];
  className?: string;
  help?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
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

  const terms = filterTerms(value);
  const lower = new Set(terms.map((t) => t.toLowerCase()));
  // while typing, narrow the list to options containing the last term
  const last = (value.split("|").pop() ?? "").trim().toLowerCase();
  const shown =
    last && !lower.has(last)
      ? options.filter((o) => o.toLowerCase().includes(last))
      : options;

  function toggle(o: string) {
    const ol = o.toLowerCase();
    let next: string[];
    if (lower.has(ol)) {
      next = terms.filter((t) => t.toLowerCase() !== ol);
    } else {
      // a half-typed last term (not an exact value) is replaced by the pick
      const partial =
        last !== "" && !options.some((x) => x.toLowerCase() === last);
      next = [...(partial ? terms.slice(0, -1) : terms), o];
    }
    onChange(next.join("|"));
  }

  const label =
    terms.length === 0
      ? allLabel
      : terms.length === 1
        ? terms[0]
        : `${terms.length} selected`;

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={value || allLabel}
        className={`flex h-9 w-full items-center justify-between gap-1 rounded-[4px] px-3 text-left text-sm focus:outline-none focus:ring-1 focus:ring-primary ${
          terms.length
            ? "bg-primary/10 font-semibold text-primary"
            : "bg-surface-container-low text-on-surface"
        }`}
      >
        <span className="truncate">{label}</span>
        <Icon
          name={open ? "expand_less" : "expand_more"}
          size={16}
          className="shrink-0 text-secondary"
        />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-64 rounded-md border border-outline-variant/60 bg-surface-container-lowest shadow-md">
          <div className="relative flex items-center border-b border-outline-variant/40">
            <input
              autoFocus
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Type or tick — use | for several"
              className="w-full px-2.5 py-1.5 pr-8 text-sm focus:outline-none"
            />
            <FilterHelp help={help} />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {shown.map((o) => (
              <label
                key={o}
                className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-sm hover:bg-surface-container-low"
              >
                <input
                  type="checkbox"
                  checked={lower.has(o.toLowerCase())}
                  onChange={() => toggle(o)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span className="truncate">{o}</span>
              </label>
            ))}
            {shown.length === 0 && (
              <p className="px-2.5 py-1.5 text-xs text-secondary">
                No matching values.
              </p>
            )}
          </div>
          {terms.length > 0 && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="w-full border-t border-outline-variant/40 px-2.5 py-1.5 text-left text-xs font-bold text-primary hover:bg-primary/5"
            >
              Clear — show {allLabel.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FilterHelp({ help }: { help: React.ReactNode }) {
  return (
    <span className="group absolute right-2 inline-flex">
      <button
        type="button"
        aria-label="How filters work"
        className="text-secondary hover:text-primary focus:text-primary focus:outline-none"
      >
        <Icon name="info" size={14} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-1 hidden w-64 rounded-md bg-inverse-surface px-3 py-2 text-left text-[12px] font-normal leading-snug text-inverse-on-surface shadow-md group-hover:block group-focus-within:block"
      >
        {help}
      </span>
    </span>
  );
}
