"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { numericKeyGuard } from "@/lib/numeric-input";
import {
  KIND_LABELS,
  MAX_RUNS_PER_PHASE,
  STANDARD_BARS,
  barArea,
  formatBar,
  type BarSize,
  type BusbarKind,
  type BusbarMaterial,
  type BusbarOverride,
  type BusbarPlan,
  type BusbarSegment,
} from "@/lib/busbar-plan";

// Plain hex colours (not theme CSS variables) so html2canvas-pro reproduces
// the overlay exactly in the PNG/PDF export.
const PRIMARY = "#006194";
const UNDERSIZED = "#dc2626";
const CABLE = "#1d4ed8";
const KIND_COLOR: Record<BusbarMaterial, { trunk: string; branch: string }> = {
  Cu: { trunk: "#b45309", branch: "#ea580c" },
  Al: { trunk: "#475569", branch: "#64748b" },
};
const STROKE: Record<BusbarKind, number> = { main: 6, incomer_riser: 5, dropper: 5, acb_link: 4, feeder_link: 3, incomer_cable_link: 3 };
const DRAW_ORDER: Record<BusbarKind, number> = { main: 0, dropper: 1, incomer_riser: 2, acb_link: 3, feeder_link: 4, incomer_cable_link: 5 };

function segmentColor(seg: BusbarSegment, material: BusbarMaterial, selected: boolean) {
  if (selected) return PRIMARY;
  if (seg.undersized) return UNDERSIZED;
  if (seg.kind === "incomer_cable_link") return CABLE;
  return seg.kind === "feeder_link" || seg.kind === "acb_link" ? KIND_COLOR[material].branch : KIND_COLOR[material].trunk;
}

const textHalo = { paintOrder: "stroke" as const, stroke: "#ffffff", strokeWidth: 3, strokeLinejoin: "round" as const };

export function BusbarFrontOverlay({
  plan,
  leftPx,
  widthPx,
  heightPx,
  xPx,
  yPx,
  material,
  selectedKey,
  onSelect,
}: {
  plan: BusbarPlan;
  leftPx: number;
  widthPx: number;
  heightPx: number;
  xPx: (mm: number) => number;
  yPx: (mm: number) => number;
  material: BusbarMaterial;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const ordered = [...plan.segments].sort((a, b) => DRAW_ORDER[a.kind] - DRAW_ORDER[b.kind]);
  // The main busbar's tag is drawn after every bar so risers/droppers
  // leaving the main bar never cross over it. It's a boxed tag sitting on
  // the bar itself -- the chamber is only ~20px tall, so text above/below
  // the bar would collide with its borders.
  const main = plan.segments.find((seg) => seg.kind === "main");
  let mainTag: React.ReactNode = null;
  if (main) {
    const color = segmentColor(main, material, main.key === selectedKey);
    const text = `MAIN BUSBAR ${formatBar(main.bar, main.runs)} ${material}${main.designCurrentA != null ? ` · ${main.designCurrentA}A` : ""}`;
    const y = yPx(main.path[0].y);
    mainTag = (
      <g
        style={{ pointerEvents: "all", cursor: "pointer" }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(main.key);
        }}
      >
        <rect x={8} y={y - 6} width={text.length * 5.4 + 8} height={12} fill="#ffffff" stroke={color} strokeWidth={1} />
        <text x={12} y={y + 3} fontSize={9} fontWeight={700} fontFamily="ui-monospace, monospace" fill={color}>
          {text}
        </text>
      </g>
    );
  }
  return (
    <svg
      className="pointer-events-none absolute top-0 overflow-visible"
      style={{ left: leftPx, width: Math.max(widthPx, 1), height: Math.max(heightPx, 1) }}
      width={Math.max(widthPx, 1)}
      height={Math.max(heightPx, 1)}
    >
      {ordered.map((seg) => {
        const selected = seg.key === selectedKey;
        const color = segmentColor(seg, material, selected);
        const select = (e: React.MouseEvent) => {
          e.stopPropagation();
          onSelect(seg.key);
        };
        const tooltip = `${seg.title}: ${formatBar(seg.bar, seg.runs)} ${material}${seg.designCurrentA != null ? ` · ${seg.designCurrentA}A` : ""}`;

        if (seg.path.length === 1) {
          const cx = xPx(seg.path[0].x);
          const cy = yPx(seg.path[0].y);
          return (
            <g key={seg.key} onClick={select} style={{ pointerEvents: "all", cursor: "pointer" }}>
              <title>{`${tooltip} — runs ${seg.lengthMm}mm front-to-back (see side view)`}</title>
              <rect x={cx - 7} y={cy - 4} width={14} height={8} fill={color} stroke={selected ? PRIMARY : "#ffffff"} strokeWidth={selected ? 2 : 1} />
              <text x={cx + 10} y={cy + 3} fontSize={8} fontFamily="ui-monospace, monospace" fill={color} style={textHalo}>
                CABLE LINK {formatBar(seg.bar, seg.runs)}
              </text>
            </g>
          );
        }

        const pts = seg.path.map((p) => `${xPx(p.x)},${yPx(p.y)}`).join(" ");
        const [a, b] = [seg.path[0], seg.path[seg.path.length - 1]];
        const vertical = Math.abs(xPx(a.x) - xPx(b.x)) < 1;
        const label = formatBar(seg.bar, seg.runs);
        let labelEl: React.ReactNode = null;
        if (seg.kind === "main") {
          // labelled by mainTag, drawn last
        } else if (vertical) {
          const x = xPx(a.x) + STROKE[seg.kind] / 2 + 4;
          const midY = (yPx(a.y) + yPx(b.y)) / 2;
          labelEl = (
            <text
              x={x}
              y={midY}
              fontSize={8}
              fontWeight={600}
              fontFamily="ui-monospace, monospace"
              fill={color}
              textAnchor="middle"
              transform={`rotate(-90 ${x} ${midY})`}
              style={textHalo}
            >
              {label}
            </text>
          );
        } else {
          const midX = (xPx(a.x) + xPx(b.x)) / 2;
          labelEl = (
            <text x={midX} y={yPx(a.y) - 4} fontSize={7} fontFamily="ui-monospace, monospace" fill={color} textAnchor="middle" style={textHalo}>
              {label}
            </text>
          );
        }

        return (
          <g key={seg.key}>
            <polyline points={pts} fill="none" stroke="transparent" strokeWidth={14} style={{ pointerEvents: "stroke", cursor: "pointer" }} onClick={select}>
              <title>{tooltip}</title>
            </polyline>
            <polyline
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth={selected ? STROKE[seg.kind] + 1.5 : STROKE[seg.kind]}
              strokeLinecap="square"
              strokeDasharray={seg.undersized && !selected ? "6 3" : undefined}
            />
            {labelEl}
          </g>
        );
      })}
      {mainTag}
    </svg>
  );
}

// Side view: the main busbar shows as a cross-section in the chamber, and
// each incomer's cable-termination bar as a front-to-back run at its
// terminal height.
export function BusbarSideOverlay({
  plan,
  widthPx,
  heightPx,
  depthMm,
  yPx,
  material,
  selectedKey,
  onSelect,
}: {
  plan: BusbarPlan;
  widthPx: number;
  heightPx: number;
  depthMm: number;
  yPx: (mm: number) => number;
  material: BusbarMaterial;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const xScale = depthMm > 0 ? widthPx / depthMm : 0;
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" style={{ width: Math.max(widthPx, 1), height: Math.max(heightPx, 1) }}>
      {plan.segments.map((seg) => {
        const selected = seg.key === selectedKey;
        const color = segmentColor(seg, material, selected);
        const select = (e: React.MouseEvent) => {
          e.stopPropagation();
          onSelect(seg.key);
        };
        if (seg.kind === "main") {
          const cy = yPx(plan.chamberMidY);
          return (
            <g key={seg.key} onClick={select} style={{ pointerEvents: "all", cursor: "pointer" }}>
              <title>{`${seg.title}: ${formatBar(seg.bar, seg.runs)} ${material}`}</title>
              <rect x={widthPx * 0.62 - 5} y={cy - 5} width={10} height={10} fill={color} stroke="#ffffff" strokeWidth={1} />
            </g>
          );
        }
        if (seg.kind === "incomer_cable_link" && seg.side) {
          const y = yPx(seg.side.y);
          const x1 = seg.side.x1 * xScale;
          const x2 = seg.side.x2 * xScale;
          return (
            <g key={seg.key}>
              <line x1={x1} y1={y} x2={x2} y2={y} stroke="transparent" strokeWidth={14} style={{ pointerEvents: "stroke", cursor: "pointer" }} onClick={select}>
                <title>{`${seg.title}: ${formatBar(seg.bar, seg.runs)} ${material}, ${seg.lengthMm}mm`}</title>
              </line>
              <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth={selected ? 4.5 : 3} strokeLinecap="square" />
              <text x={(x1 + x2) / 2} y={y - 4} fontSize={7} fontFamily="ui-monospace, monospace" fill={color} textAnchor="middle" style={textHalo}>
                {seg.lengthMm}mm
              </text>
            </g>
          );
        }
        return null;
      })}
    </svg>
  );
}

function barValue(bar: BarSize | null) {
  return bar ? `${bar.widthMm}x${bar.thicknessMm}` : "";
}

function parseBar(v: string): BarSize | null {
  const [w, t] = v.split("x").map(Number);
  return w > 0 && t > 0 ? { widthMm: w, thicknessMm: t } : null;
}

function barOptions(current: BarSize | null): BarSize[] {
  if (!current || STANDARD_BARS.some((b) => b.widthMm === current.widthMm && b.thicknessMm === current.thicknessMm)) return STANDARD_BARS;
  return [...STANDARD_BARS, current].sort((a, b) => barArea(a) - barArea(b));
}

type OverridePatch = Partial<Pick<BusbarOverride, "barWidthMm" | "barThicknessMm" | "runsPerPhase" | "lengthMm">>;

// Right-sidebar editor for one clicked busbar segment. Choosing the same
// value the plan picked automatically clears that override instead of
// pinning it, so "Overridden" only ever marks genuine departures from auto.
export function BusbarSegmentPanel({
  segment,
  material,
  density,
  neutralPct,
  hasNeutral,
  readOnly,
  onPatch,
  onReset,
  onClose,
}: {
  segment: BusbarSegment;
  material: BusbarMaterial;
  density: number;
  neutralPct: number;
  hasNeutral: boolean;
  readOnly: boolean;
  onPatch: (patch: OverridePatch) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [localLength, setLocalLength] = useState(segment.overridden.length ? String(segment.lengthMm) : "");
  const anyOverride = segment.overridden.size || segment.overridden.runs || segment.overridden.length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="font-label-sm text-label-sm uppercase tracking-wide text-secondary">Busbar</p>
        <button onClick={onClose} title="Deselect" className="text-secondary hover:text-on-surface">
          <Icon name="close" size={14} />
        </button>
      </div>
      <p className="text-sm font-semibold text-on-surface">{segment.title}</p>
      <p className="mb-2 text-[11px] text-on-surface-variant">
        {segment.fromLabel} → {segment.toLabel}
      </p>
      <div className="mb-3 flex flex-wrap gap-1">
        <span className="rounded border border-surface-container-high bg-surface-container-low px-1.5 py-0.5 text-[10px] text-secondary">
          {KIND_LABELS[segment.kind]}
        </span>
        {anyOverride ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Overridden</span>
        ) : (
          <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-secondary">Auto</span>
        )}
        {segment.undersized && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Undersized</span>}
      </div>

      <dl className="mb-3 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
        <dt className="text-on-surface-variant">Design current</dt>
        <dd className="text-right font-mono text-on-surface">{segment.designCurrentA != null ? `${segment.designCurrentA} A` : "—"}</dd>
        <dt className="text-on-surface-variant">Current density</dt>
        <dd className="text-right font-mono text-on-surface">
          {density} A/mm² {material}
        </dd>
        <dt className="text-on-surface-variant">Required / phase</dt>
        <dd className="text-right font-mono text-on-surface">{segment.requiredAreaMm2 != null ? `${segment.requiredAreaMm2} mm²` : "—"}</dd>
        <dt className="text-on-surface-variant">Auto size</dt>
        <dd className="text-right font-mono text-on-surface">{segment.auto ? formatBar(segment.auto.bar, segment.auto.runs) : "—"}</dd>
        <dt className="text-on-surface-variant">Capacity</dt>
        <dd className={`text-right font-mono ${segment.undersized ? "font-semibold text-red-700" : "text-on-surface"}`}>
          {segment.capacityA != null ? `${segment.capacityA} A` : "—"}
        </dd>
      </dl>

      <div className="mb-2 flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-[10px] font-medium text-on-surface-variant">Bar size (mm){segment.overridden.size ? " •" : ""}</span>
          <select
            disabled={readOnly}
            value={barValue(segment.bar)}
            onChange={(e) => {
              const bar = parseBar(e.target.value);
              if (!bar) return;
              const isAuto = segment.auto && segment.auto.bar.widthMm === bar.widthMm && segment.auto.bar.thicknessMm === bar.thicknessMm;
              onPatch(isAuto ? { barWidthMm: null, barThicknessMm: null } : { barWidthMm: bar.widthMm, barThicknessMm: bar.thicknessMm });
            }}
            className="w-full rounded border border-surface-container-high px-1.5 py-1 text-sm disabled:bg-surface-container-low"
          >
            {!segment.bar && <option value="">—</option>}
            {barOptions(segment.bar).map((b) => (
              <option key={barValue(b)} value={barValue(b)}>
                {b.widthMm} × {b.thicknessMm} ({barArea(b)} mm²)
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-[10px] font-medium text-on-surface-variant">Runs/phase{segment.overridden.runs ? " •" : ""}</span>
          <select
            disabled={readOnly}
            value={segment.runs}
            onChange={(e) => {
              const runs = Number(e.target.value);
              onPatch({ runsPerPhase: segment.auto && segment.auto.runs === runs ? null : runs });
            }}
            className="rounded border border-surface-container-high px-1.5 py-1 text-sm disabled:bg-surface-container-low"
          >
            {Array.from({ length: MAX_RUNS_PER_PHASE }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mb-2 block">
        <span className="mb-1 block text-[10px] font-medium text-on-surface-variant">Length (mm){segment.overridden.length ? " •" : ""}</span>
        <input
          type="text"
          inputMode="decimal"
          value={localLength}
          placeholder={`${segment.autoLengthMm} (auto)`}
          disabled={readOnly}
          onChange={(e) => setLocalLength(e.target.value)}
          onKeyDown={numericKeyGuard()}
          onBlur={() => {
            const n = Math.round(Number(localLength));
            if (!localLength.trim() || !n || n === segment.autoLengthMm) {
              setLocalLength("");
              onPatch({ lengthMm: null });
            } else {
              onPatch({ lengthMm: n });
            }
          }}
          className="w-full rounded border border-surface-container-high px-2 py-1 text-sm disabled:bg-surface-container-low"
        />
      </label>

      <p className="mb-1 text-[11px] text-on-surface-variant">
        Neutral:{" "}
        <span className="font-mono text-on-surface">
          {hasNeutral ? `${formatBar(segment.neutral?.bar ?? null, segment.neutral?.runs ?? 1)} (${neutralPct}%)` : "none — 3-pole"}
        </span>
      </p>
      <p className="mb-3 text-[11px] text-on-surface-variant">
        Weight (all {hasNeutral ? "3 phases + N" : "3 phases"}):{" "}
        <span className="font-mono text-on-surface">{segment.weightKg != null ? `${segment.weightKg} kg` : "—"}</span>
      </p>

      {!readOnly && anyOverride && (
        <button onClick={onReset} className="btn btn-outline btn-sm mb-3 w-full">
          <Icon name="restart_alt" size={14} /> Reset to auto
        </button>
      )}

      {segment.notes.map((n, i) => (
        <p key={`n${i}`} className="mb-1 text-[11px] leading-snug text-on-surface-variant">
          {n}
        </p>
      ))}
      {segment.warnings.map((w, i) => (
        <p key={`w${i}`} className="mb-1 flex gap-1 text-[11px] leading-snug text-amber-700">
          <Icon name="warning" size={12} className="mt-0.5" />
          {w}
        </p>
      ))}
    </div>
  );
}

// Tabular view of every planned busbar segment, under the drawing. Rows can
// be ticked and re-sized in one go (e.g. "all feeder links to 30×10").
export function BusbarSchedule({
  plan,
  material,
  density,
  poles,
  neutralPct,
  readOnly,
  selectedKey,
  onSelect,
  onApplySize,
  onReset,
}: {
  plan: BusbarPlan;
  material: BusbarMaterial;
  density: number;
  poles: number;
  neutralPct: number;
  readOnly: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onApplySize: (segments: BusbarSegment[], bar: BarSize, runs: number) => void;
  onReset: (keys: string[]) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBar, setBulkBar] = useState(barValue(STANDARD_BARS[6]));
  const [bulkRuns, setBulkRuns] = useState(1);
  const liveChecked = plan.segments.filter((s) => checked.has(s.key));
  const overriddenKeys = plan.segments.filter((s) => s.overridden.size || s.overridden.runs || s.overridden.length).map((s) => s.key);
  const allChecked = plan.segments.length > 0 && liveChecked.length === plan.segments.length;

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="mt-6 rounded-xl border border-surface-container-high bg-surface-container-lowest p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-secondary">Busbar Schedule</p>
          <p className="text-[11px] text-on-surface-variant">
            {material} at {density} A/mm² · {poles >= 4 ? `3 phases + neutral at ${neutralPct}%` : "3-pole, no neutral"} · total{" "}
            <span className="font-semibold text-on-surface">{plan.totalWeightKg.toFixed(1)} kg</span>. Click a row or a bar in the drawing to edit it.
          </p>
        </div>
        {!readOnly && overriddenKeys.length > 0 && (
          <button onClick={() => onReset(overriddenKeys)} className="btn btn-outline btn-sm">
            <Icon name="restart_alt" size={14} /> Reset all {overriddenKeys.length} override(s)
          </button>
        )}
      </div>

      {plan.warnings.map((w, i) => (
        <p key={i} className="mb-2 flex gap-1 text-[11px] text-amber-700">
          <Icon name="warning" size={12} className="mt-0.5" />
          {w}
        </p>
      ))}

      {!readOnly && liveChecked.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-inverse-surface px-3 py-2 text-xs text-inverse-on-surface">
          <span className="font-semibold">{liveChecked.length} selected</span>
          <span className="opacity-60">Set size</span>
          <select value={bulkBar} onChange={(e) => setBulkBar(e.target.value)} className="rounded bg-surface-container-lowest px-1.5 py-1 text-on-surface">
            {STANDARD_BARS.map((b) => (
              <option key={barValue(b)} value={barValue(b)}>
                {b.widthMm} × {b.thicknessMm}
              </option>
            ))}
          </select>
          <span className="opacity-60">runs</span>
          <select value={bulkRuns} onChange={(e) => setBulkRuns(Number(e.target.value))} className="rounded bg-surface-container-lowest px-1.5 py-1 text-on-surface">
            {Array.from({ length: MAX_RUNS_PER_PHASE }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const bar = parseBar(bulkBar);
              if (bar) onApplySize(liveChecked, bar, bulkRuns);
            }}
            className="rounded bg-primary px-2 py-1 font-medium text-on-primary hover:bg-primary-container"
          >
            Apply
          </button>
          <button
            onClick={() => onReset(liveChecked.map((s) => s.key))}
            className="rounded bg-surface-container-low px-2 py-1 font-medium text-on-surface hover:bg-surface-container-high"
          >
            Reset to auto
          </button>
          <button onClick={() => setChecked(new Set())} className="ml-auto opacity-70 hover:opacity-100">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-xs">
          <thead className="text-[10px] font-semibold uppercase tracking-wide text-secondary">
            <tr className="border-b border-surface-container-high">
              {!readOnly && (
                <th className="w-7 px-1 py-1.5">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() => setChecked(allChecked ? new Set() : new Set(plan.segments.map((s) => s.key)))}
                  />
                </th>
              )}
              <th className="px-2 py-1.5">Busbar</th>
              <th className="px-2 py-1.5">From → To</th>
              <th className="px-2 py-1.5 text-right">Design A</th>
              <th className="px-2 py-1.5 text-right">Req. mm²</th>
              <th className="px-2 py-1.5">Phase bar</th>
              <th className="px-2 py-1.5">Neutral</th>
              <th className="px-2 py-1.5 text-right">Length</th>
              <th className="px-2 py-1.5 text-right">Weight</th>
              <th className="px-2 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container">
            {plan.segments.map((s) => {
              const overridden = s.overridden.size || s.overridden.runs || s.overridden.length;
              return (
                <tr
                  key={s.key}
                  onClick={() => onSelect(s.key)}
                  className={`cursor-pointer ${s.key === selectedKey ? "bg-primary/10" : "hover:bg-surface-container-low"}`}
                >
                  {!readOnly && (
                    <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked.has(s.key)} onChange={() => toggle(s.key)} />
                    </td>
                  )}
                  <td className="px-2 py-1 font-medium text-on-surface">{s.title}</td>
                  <td className="max-w-[260px] truncate px-2 py-1 text-on-surface-variant" title={`${s.fromLabel} → ${s.toLabel}`}>
                    {s.fromLabel} → {s.toLabel}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{s.designCurrentA ?? "—"}</td>
                  <td className="px-2 py-1 text-right font-mono">{s.requiredAreaMm2 ?? "—"}</td>
                  <td className={`px-2 py-1 font-mono ${s.undersized ? "font-semibold text-red-700" : "text-on-surface"}`}>
                    {formatBar(s.bar, s.runs)}
                  </td>
                  <td className="px-2 py-1 font-mono text-on-surface-variant">{s.neutral ? formatBar(s.neutral.bar, s.neutral.runs) : "—"}</td>
                  <td className="px-2 py-1 text-right font-mono">{s.lengthMm}</td>
                  <td className="px-2 py-1 text-right font-mono">{s.weightKg != null ? s.weightKg.toFixed(2) : "—"}</td>
                  <td className="px-2 py-1">
                    <span className="flex items-center gap-1">
                      {overridden ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Overridden</span>
                      ) : (
                        <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-secondary">Auto</span>
                      )}
                      {s.undersized && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Undersized</span>}
                      {s.warnings.length > 0 && !s.undersized && (
                        <span title={s.warnings.join("\n")} className="text-amber-600">
                          <Icon name="warning" size={13} />
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {plan.segments.length === 0 && (
              <tr>
                <td colSpan={10} className="px-2 py-6 text-center text-on-surface-variant">
                  No busbars to plan yet — place an incomer and feeders into bays first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
