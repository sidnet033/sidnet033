"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";

// "What do the colours mean?" -- an info icon (hover, focus or click)
// listing the text/background colours used for items and feeders.
type Part = "items" | "feeders" | "editing";

export function ColorLegend({
  parts = ["items"],
  align = "right",
}: {
  parts?: Part[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <span ref={ref} className="group relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="What the colours mean"
        title="What the colours mean"
        className="inline-flex items-center gap-0.5 rounded px-1 text-[11px] font-medium text-secondary hover:text-primary focus:text-primary focus:outline-none"
      >
        <Icon name="palette" size={14} /> Colours
      </button>
      <span
        role="tooltip"
        className={`absolute top-full z-50 mt-1 w-80 rounded-md border border-surface-container-high bg-surface-container-lowest p-3 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-on-surface shadow-lg ${
          align === "right" ? "right-0" : "left-0"
        } ${open ? "block" : "hidden group-hover:block group-focus-within:block"}`}
      >
        {parts.includes("items") && (
          <>
            <b className="mb-1 block text-[11px] uppercase tracking-wider text-secondary">
              Items
            </b>
            <Row
              swatch={<span className="font-bold text-on-surface">Abc</span>}
            >
              Normal item (Design source, active).
            </Row>
            <Row
              swatch={
                <span className="font-bold" style={{ color: "#c2185b" }}>
                  Abc
                </span>
              }
            >
              <b>Pink text</b> — Estimation-source item: raised during
              estimation, so double-check its cost and details.
            </Row>
            <Row
              swatch={
                <span className="font-bold" style={{ color: "#9aa3ad" }}>
                  Abc
                </span>
              }
            >
              <b>Grey text</b> — Archived item: don&apos;t use it in new
              feeders.
            </Row>
            <Row
              swatch={
                <span className="inline-block h-3.5 w-7 rounded-sm border border-red-200 bg-red-50" />
              }
            >
              <b>Red background</b> (BOM Builder) — item has no price: set a
              list price in Item Master or override it on the line.
            </Row>
          </>
        )}
        {parts.includes("editing") && (
          <Row
            swatch={
              <span className="inline-block h-3.5 w-7 rounded-sm bg-tertiary-fixed/40" />
            }
          >
            <b>Highlighted row</b> — the item you&apos;re editing.
          </Row>
        )}
        {parts.includes("feeders") && (
          <>
            <b className="mb-1 mt-2 block text-[11px] uppercase tracking-wider text-secondary">
              Feeders
            </b>
            <Row
              swatch={
                <span className="inline-block h-3.5 w-7 rounded-sm border border-amber-100 bg-amber-50" />
              }
            >
              <b>Amber header</b> — just added from the library; becomes this
              board&apos;s own copy when you save.
            </Row>
            <Row
              swatch={
                <span className="inline-block h-3.5 w-7 rounded-sm border border-emerald-100 bg-emerald-50" />
              }
            >
              <b>Green header</b> — this board&apos;s own feeder (custom, or its
              saved copy of a library feeder).
            </Row>
            <Row
              swatch={
                <span className="inline-block h-3.5 w-7 rounded-sm border-2 border-amber-400 bg-amber-50" />
              }
            >
              <b>Amber outline + warning strip</b> — feeder rated above the
              switchboard&apos;s Amps.
            </Row>
          </>
        )}
      </span>
    </span>
  );
}

function Row({
  swatch,
  children,
}: {
  swatch: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="mb-1.5 flex items-start gap-2">
      <span className="flex w-8 shrink-0 justify-center pt-0.5">{swatch}</span>
      <span>{children}</span>
    </span>
  );
}
