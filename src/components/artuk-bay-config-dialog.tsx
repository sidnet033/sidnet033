"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import {
  ARTUK_BAY_CONFIGS,
  ARTUK_HEIGHT_MM,
  bayImage,
  sheetImage,
  type ArtukBayConfig,
} from "@/lib/artuk-bay-configs";

// Pick a standard ABB ArTu-K vertical for a GA bay. Left: every config with
// its key specs; right: the selected config's ABB sheet data -- the spec box
// (width, depth, height, IP, form, overall dimension, ACB type) and the GA
// front + side view -- with a link to the full sheet and its parts list.
export function ArtukBayConfigDialog({
  bayName,
  currentId,
  misfitsFor,
  onApply,
  onClose,
}: {
  bayName: string;
  currentId: string | null;
  misfitsFor: (c: ArtukBayConfig) => string[];
  onApply: (c: ArtukBayConfig) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState(
    currentId ?? ARTUK_BAY_CONFIGS[0].id,
  );
  const sel =
    ARTUK_BAY_CONFIGS.find((c) => c.id === selectedId) ?? ARTUK_BAY_CONFIGS[0];
  const selMisfits = misfitsFor(sel);

  return (
    <Modal
      title={`ArTu-K bay config — ${bayName}`}
      onClose={onClose}
      width="max-w-7xl"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* list */}
        <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
          {ARTUK_BAY_CONFIGS.map((c) => {
            const misfits = misfitsFor(c);
            const active = c.id === sel.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`flex w-full gap-2.5 rounded-lg border p-2 text-left transition-colors ${
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-surface-container-high hover:bg-surface-container-low"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bayImage(c)}
                  alt=""
                  loading="lazy"
                  className="h-20 w-20 shrink-0 rounded border border-surface-container-high bg-white object-contain"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold leading-tight text-on-surface">
                    {c.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-secondary">
                    {widthText(c)} × {depthText(c)} × {ARTUK_HEIGHT_MM} mm · IP
                    {c.ip} · Form {c.form}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {c.id === currentId && <Pill tone="blue">Current</Pill>}
                    {misfits.length === 0 ? (
                      <Pill tone="green">Suits this bay</Pill>
                    ) : (
                      <Pill tone="amber">May not suit</Pill>
                    )}
                    {c.partner && (
                      <Pill tone="grey">+ {c.partner.widthMm}mm bay</Pill>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* detail */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-[15px] font-bold text-on-surface">
                {sel.label}
              </h4>
              <p className="text-[11px] text-secondary">
                ABB · ArTu-K Assembly Guideline &amp; Standard Compartment Sizes
                (ELSP/ARTUK/ENGG/WEL KIT, R3) · page {sel.page} of 17
              </p>
            </div>
            <table className="border-collapse text-[12px]">
              <tbody>
                <SpecRow k="Panel Width" v={`${widthText(sel)}mm`} />
                <SpecRow k="Panel Depth" v={`${depthText(sel)}mm`} />
                <SpecRow k="Panel Height" v={`${ARTUK_HEIGHT_MM}mm`} />
                <SpecRow k="Ingress Protection" v={`IP${sel.ip}`} />
                <SpecRow k="Form of Separation" v={`Form ${sel.form}`} />
                <SpecRow
                  k="Overall Dimension"
                  v={`${overallWidth(sel)}×${sel.depthMm}×${ARTUK_HEIGHT_MM} mm`}
                />
                <SpecRow
                  k={sel.kind === "acb" ? "ACB Type" : "Breaker Type"}
                  v={sel.kind === "acb" ? `Emax 2_${sel.frame}` : "MCCB"}
                />
                <SpecRow
                  k="Access"
                  v={sel.access === "front" ? "Front access" : "Rear access"}
                />
              </tbody>
            </table>
          </div>

          {sel.note && (
            <p className="text-[12px] text-on-surface-variant">{sel.note}</p>
          )}
          {sel.partner && (
            <p className="text-[12px] text-on-surface-variant">
              Two bays: this bay becomes {sel.widthMm}mm and a{" "}
              {sel.partner.widthMm}mm{" "}
              {sel.partner.bayType === "cable_alley" ? "cable chamber" : "bay"}{" "}
              (&quot;{sel.partner.name}&quot;) is added right next to it.
            </p>
          )}

          {selMisfits.length > 0 && (
            <div className="rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-900">
              <b>May not suit this bay</b> — you can still apply it:
              <ul className="mt-0.5 list-disc pl-5">
                {selMisfits.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-container-low px-3 py-2">
            <a
              href={sheetImage(sel)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-primary hover:underline"
            >
              Open the full ABB sheet (with parts list) ↗
            </a>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn btn-outline btn-sm">
                Cancel
              </button>
              <button
                onClick={() => onApply(sel)}
                className="btn btn-primary btn-sm"
              >
                {sel.id === currentId
                  ? "Re-apply this config"
                  : "Apply to this bay"}
              </button>
            </div>
          </div>
          <div className="rounded-lg border border-surface-container-high bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={bayImage(sel)}
              alt={`${sel.label} — front and side view`}
              className="mx-auto max-h-[42vh] w-auto object-contain"
            />
          </div>

          <p className="text-[11px] text-secondary">
            Applying sets the bay&apos;s width and depth (the whole panel takes
            the deepest bay&apos;s depth), adds a partner bay where the config
            has one, and redraws the busbars, busbar supports and enclosure
            parts from the new layout. Feeders stay where they are.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function widthText(c: ArtukBayConfig) {
  return c.partner ? `${c.widthMm}+${c.partner.widthMm}` : String(c.widthMm);
}
function depthText(c: ArtukBayConfig) {
  return c.depthNote ?? String(c.depthMm);
}
// ABB's overall width adds 28mm for the end side panels
function overallWidth(c: ArtukBayConfig) {
  return c.widthMm + (c.partner?.widthMm ?? 0) + 28;
}

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td className="border border-surface-container-high bg-surface-container-low px-2 py-0.5 font-bold">
        {k}
      </td>
      <td className="border border-surface-container-high px-2 py-0.5 tabular-nums">
        {v}
      </td>
    </tr>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "blue" | "green" | "amber" | "grey";
  children: React.ReactNode;
}) {
  const cls = {
    blue: "bg-primary/10 text-primary",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    grey: "bg-surface-container-high text-on-surface-variant",
  }[tone];
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>
      {children}
    </span>
  );
}
