"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { numericKeyGuard } from "@/lib/numeric-input";
import {
  KIND_LABELS,
  MAX_RUNS_PER_PHASE,
  BAR_SIZES,
  barArea,
  formatBar,
  isStockedBar,
  stretchPath,
  type BarSize,
  type BusbarKind,
  type BusbarMaterial,
  type BusbarOverride,
  type BusbarPlan,
  type BusbarSegment,
  type Point,
} from "@/lib/busbar-plan";

// Plain hex colours (not theme CSS variables) so html2canvas-pro reproduces
// the overlay exactly in the PNG/PDF export.
const PRIMARY = "#006194";
const UNDERSIZED = "#dc2626";
const KIND_COLOR: Record<BusbarMaterial, { trunk: string; branch: string }> = {
  Cu: { trunk: "#b45309", branch: "#ea580c" },
  Al: { trunk: "#475569", branch: "#64748b" },
};
const STROKE: Record<BusbarKind, number> = { main: 6, incomer_riser: 5, dropper: 5, acb_link: 4, feeder_link: 3, incomer_cable_link: 3 };
const DRAW_ORDER: Record<BusbarKind, number> = { main: 0, dropper: 1, incomer_riser: 2, acb_link: 3, feeder_link: 4, incomer_cable_link: 5 };

function segmentColor(seg: BusbarSegment, material: BusbarMaterial, selected: boolean) {
  if (selected) return PRIMARY;
  if (seg.undersized) return UNDERSIZED;
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
  pxPerMm,
  readOnly,
  onStretch,
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
  pxPerMm: number;
  readOnly: boolean;
  // drag result: mm added (or, negative, removed) at that end of the bar
  onStretch: (key: string, end: "start" | "end", deltaMm: number) => void;
}) {
  // Live drag of a selected bar's end handle (preview only until release).
  const [drag, setDrag] = useState<{ key: string; end: "start" | "end"; startX: number; startY: number; deltaMm: number } | null>(null);
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

        // An ACB's cable link runs straight back into the panel, so the front
        // view shows it end-on: a marker at the terminal the cables land on
        // (the bar itself is drawn in the side view).
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

        const dragging = drag && drag.key === seg.key ? drag : null;
        const path = dragging ? stretchPath(seg.path, dragging.end === "start" ? dragging.deltaMm : 0, dragging.end === "end" ? dragging.deltaMm : 0) : seg.path;
        const pts = path.map((p) => `${xPx(p.x)},${yPx(p.y)}`).join(" ");
        const [a, b] = [path[0], path[path.length - 1]];
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
            {selected &&
              !readOnly &&
              (["start", "end"] as const).map((end) => {
                const tip = end === "start" ? path[0] : path[path.length - 1];
                const prev = end === "start" ? path[1] : path[path.length - 2];
                // unit vector (px) pointing outward along the bar at this end
                const dx = xPx(tip.x) - xPx(prev.x);
                const dy = yPx(tip.y) - yPx(prev.y);
                const len = Math.hypot(dx, dy) || 1;
                const ux = dx / len;
                const uy = dy / len;
                const hx = xPx(tip.x);
                const hy = yPx(tip.y);
                return (
                  <g key={end}>
                    <rect
                      x={hx - 5}
                      y={hy - 5}
                      width={10}
                      height={10}
                      fill="#ffffff"
                      stroke={PRIMARY}
                      strokeWidth={2}
                      style={{ pointerEvents: "all", cursor: Math.abs(ux) > Math.abs(uy) ? "ew-resize" : "ns-resize", touchAction: "none" }}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        (e.target as Element).setPointerCapture(e.pointerId);
                        setDrag({ key: seg.key, end, startX: e.clientX, startY: e.clientY, deltaMm: 0 });
                      }}
                      onPointerMove={(e) => {
                        if (!drag || drag.key !== seg.key || drag.end !== end) return;
                        const along = (e.clientX - drag.startX) * ux + (e.clientY - drag.startY) * uy;
                        // 5mm steps, and never shorter than 20mm overall
                        const raw = Math.round(along / pxPerMm / 5) * 5;
                        setDrag({ ...drag, deltaMm: Math.max(raw, 20 - seg.lengthMm) });
                      }}
                      onPointerUp={(e) => {
                        (e.target as Element).releasePointerCapture(e.pointerId);
                        if (drag && drag.key === seg.key && drag.end === end && drag.deltaMm !== 0) onStretch(seg.key, end, drag.deltaMm);
                        setDrag(null);
                      }}
                    >
                      <title>Drag to make this bar longer or shorter</title>
                    </rect>
                    {dragging && dragging.end === end && (
                      <text x={hx + 8} y={hy - 8} fontSize={9} fontWeight={700} fontFamily="ui-monospace, monospace" fill={PRIMARY} style={textHalo}>
                        {`${seg.lengthMm + dragging.deltaMm}mm (${dragging.deltaMm >= 0 ? "+" : ""}${dragging.deltaMm})`}
                      </text>
                    )}
                  </g>
                );
              })}
          </g>
        );
      })}
      {mainTag}
    </svg>
  );
}

// Offsets (px) of every bar of a segment across its width: one group per
// phase (R, Y, B, then N when there's a neutral), each group holding that
// phase's parallel runs -- so 2 runs per phase on a 4-pole board draws as
// four sets of two lines.
function barOffsets(seg: BusbarSegment, hasNeutral: boolean, runGap: number, phaseGap: number): { offset: number; phase: string }[] {
  const groups: { phase: string; runs: number }[] = [
    { phase: "R", runs: seg.runs },
    { phase: "Y", runs: seg.runs },
    { phase: "B", runs: seg.runs },
  ];
  if (hasNeutral && seg.neutral) groups.push({ phase: "N", runs: seg.neutral.runs });
  const out: { offset: number; phase: string }[] = [];
  let at = 0;
  groups.forEach((g, gi) => {
    for (let r = 0; r < g.runs; r++) {
      out.push({ offset: at, phase: g.phase });
      at += runGap;
    }
    at += gi < groups.length - 1 ? phaseGap - runGap : 0;
  });
  const span = out.length ? out[out.length - 1].offset : 0;
  return out.map((o) => ({ ...o, offset: o.offset - span / 2 }));
}

const PHASE_COLOR: Record<string, string> = { R: "#dc2626", Y: "#ca8a04", B: "#2563eb", N: "#111827" };

// A side-view bar drawn as its individual phases × runs: each straight leg
// of `pts` becomes parallel lines offset perpendicular to the leg.
function PhaseBars({
  seg,
  pts,
  hasNeutral,
  color,
  selected,
  onSelect,
  title,
}: {
  seg: BusbarSegment;
  pts: Point[];
  hasNeutral: boolean;
  color: string;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  title: string;
}) {
  const offsets = barOffsets(seg, hasNeutral, 2.5, 5);
  const legs: React.ReactNode[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    // perpendicular, oriented so phases always read R→N top-to-bottom on
    // a horizontal leg and left-to-right on a vertical one
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    if (ny < -1e-9 || (Math.abs(ny) < 1e-9 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    legs.push(
      <line key={`hit${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={Math.max(14, offsets.length * 3)} style={{ pointerEvents: "stroke", cursor: "pointer" }} onClick={onSelect}>
        <title>{title}</title>
      </line>
    );
    offsets.forEach((o, j) =>
      legs.push(
        <line
          key={`${i}-${j}`}
          x1={a.x + nx * o.offset}
          y1={a.y + ny * o.offset}
          x2={b.x + nx * o.offset}
          y2={b.y + ny * o.offset}
          stroke={selected ? PRIMARY : seg.undersized ? UNDERSIZED : PHASE_COLOR[o.phase] ?? color}
          strokeWidth={selected ? 1.6 : 1.2}
          strokeLinecap="square"
        />
      )
    );
  }
  return <g>{legs}</g>;
}

// Main busbar seen end-on: every bar as a small upright rectangle (bar
// thickness wide, bar width tall), grouped by phase.
function MainCrossSection({
  seg,
  cx,
  cy,
  maxHeightPx,
  pxPerMm,
  hasNeutral,
  selected,
  onSelect,
  material,
}: {
  seg: BusbarSegment;
  cx: number;
  cy: number;
  maxHeightPx: number;
  pxPerMm: number;
  hasNeutral: boolean;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  material: BusbarMaterial;
}) {
  const t = Math.max(1.5, (seg.bar?.thicknessMm ?? 10) * pxPerMm);
  const offsets = barOffsets(seg, hasNeutral, t + 1.5, t + 6);
  return (
    <g onClick={onSelect} style={{ pointerEvents: "all", cursor: "pointer" }}>
      <title>{`${seg.title}: ${formatBar(seg.bar, seg.runs)} ${material} per phase${seg.neutral ? `, N ${formatBar(seg.neutral.bar, seg.neutral.runs)}` : ""}`}</title>
      {offsets.map((o, i) => {
        const bar = o.phase === "N" && seg.neutral ? seg.neutral.bar : seg.bar;
        const h = Math.max(4, Math.min(maxHeightPx, (bar?.widthMm ?? 40) * pxPerMm));
        return (
          <rect
            key={i}
            x={cx + o.offset - t / 2}
            y={cy - h / 2}
            width={t}
            height={h}
            fill={selected ? PRIMARY : seg.undersized ? UNDERSIZED : PHASE_COLOR[o.phase]}
            stroke="#ffffff"
            strokeWidth={0.5}
          />
        );
      })}
    </g>
  );
}

export type SideBay = {
  id: string;
  name: string;
  // compartments in panel coordinates (mm from the top of the panel block)
  compartments: { id: string; label: string; topMm: number; heightMm: number; isBlank: boolean; placedId?: string }[];
  // y (plan mm) where the panel itself starts -- below the chamber when the
  // chamber is on top
  panelTopMm: number;
};

// Side view of the bay selected in the front view, looking at it from the
// side with the panel FRONT ON THE RIGHT: the bay's devices, their rear
// terminals, and every bar that serves them -- riser / ACB link / dropper /
// feeder links, plus the main busbar end-on -- each drawn as phases × runs
// and labelled with size and current, so the routing and sizing can be
// followed -- including each ACB's cable link, the bar running back from
// the terminal its cables land on.
export function BusbarSideOverlay({
  plan,
  widthPx,
  heightPx,
  depthMm,
  yPx,
  pxPerMm,
  chamberPx,
  material,
  hasNeutral,
  showBars,
  bay,
  selectedKey,
  onSelect,
}: {
  plan: BusbarPlan | null;
  widthPx: number;
  heightPx: number;
  depthMm: number;
  yPx: (mm: number) => number;
  pxPerMm: number;
  chamberPx: number;
  material: BusbarMaterial;
  hasNeutral: boolean;
  showBars: boolean;
  bay: SideBay | null;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const xScale = depthMm > 0 ? widthPx / depthMm : 0;
  // depth measured from the panel front, which is drawn on the right
  const x = (mm: number) => widthPx - mm * xScale;
  const segs = showBars && plan ? plan.segments : [];
  const main = segs.find((s) => s.kind === "main") ?? null;
  const select = (key: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(key);
  };
  const label = (seg: BusbarSegment) => `${formatBar(seg.bar, seg.runs)}${seg.designCurrentA != null ? ` · ${seg.designCurrentA}A` : ""}`;
  const tip = (seg: BusbarSegment) =>
    `${seg.title}: ${formatBar(seg.bar, seg.runs)} ${material} per phase${seg.neutral ? `, N ${formatBar(seg.neutral.bar, seg.neutral.runs)}` : ""} · ${seg.lengthMm}mm${seg.designCurrentA != null ? ` · ${seg.designCurrentA}A` : ""}`;
  const colorOf = (seg: BusbarSegment) => segmentColor(seg, material, seg.key === selectedKey);
  const tag = (seg: BusbarSegment, at: Point, anchor: "start" | "middle" | "end" = "middle", dy = -5) => (
    <text x={at.x} y={at.y + dy} fontSize={7} fontWeight={600} fontFamily="ui-monospace, monospace" fill={colorOf(seg)} textAnchor={anchor} style={textHalo}>
      {label(seg)}
    </text>
  );

  // Nothing to show until a bay is chosen in the front view.
  if (!bay) return null;

  // ---- one bay -----------------------------------------------------------
  // Depth zones (mm from the front): devices at the front, their rear
  // terminals, then the main busbar / dropper zone at the back.
  const deviceDepth = Math.min(depthMm * 0.35, 400);
  const mainX = depthMm * 0.72;
  const termX = x(deviceDepth);
  const placedIds = new Set(bay.compartments.map((c) => c.placedId).filter(Boolean) as string[]);
  const own = segs.filter((seg) => seg.placedFeederId && placedIds.has(seg.placedFeederId));
  const feederLinks = own.filter((seg) => seg.kind === "feeder_link");
  const dropperXs = new Set(feederLinks.map((f) => f.path[0].x));
  const droppers = segs.filter((seg) => seg.kind === "dropper" && (seg.verticalId === bay.id || dropperXs.has(seg.path[0].x)));
  const chamberY = plan ? yPx(plan.chamberMidY) : 0;
  const terminals: Point[] = [];

  const drawn: React.ReactNode[] = [];
  for (const seg of own) {
    const sel = seg.key === selectedKey;
    if (seg.kind === "incomer_riser" || seg.kind === "acb_link") {
      const ty = yPx(seg.kind === "incomer_riser" ? seg.path[0].y : seg.path[seg.path.length - 1].y);
      terminals.push({ x: termX, y: ty });
      const pts = [
        { x: termX, y: ty },
        { x: x(mainX), y: ty },
        { x: x(mainX), y: chamberY },
      ];
      drawn.push(
        <g key={seg.key}>
          <PhaseBars seg={seg} pts={pts} hasNeutral={hasNeutral} color={colorOf(seg)} selected={sel} onSelect={select(seg.key)} title={tip(seg)} />
          {tag(seg, { x: x(mainX) - 8, y: (ty + chamberY) / 2 }, "end", 0)}
        </g>
      );
    } else if (seg.kind === "incomer_cable_link") {
      // from the ACB's cable-side terminal straight back into the panel
      const ty = yPx(seg.side?.y ?? seg.path[0].y);
      terminals.push({ x: termX, y: ty });
      const end = Math.min(deviceDepth + seg.lengthMm, depthMm - 10);
      const pts = [
        { x: termX, y: ty },
        { x: x(end), y: ty },
      ];
      drawn.push(
        <g key={seg.key}>
          <PhaseBars seg={seg} pts={pts} hasNeutral={hasNeutral} color={colorOf(seg)} selected={sel} onSelect={select(seg.key)} title={tip(seg)} />
          <text x={(pts[0].x + pts[1].x) / 2} y={ty + 14} fontSize={7} fontFamily="ui-monospace, monospace" fill={colorOf(seg)} textAnchor="middle" style={textHalo}>
            CABLE LINK {seg.lengthMm}mm
          </text>
          {tag(seg, { x: (pts[0].x + pts[1].x) / 2, y: ty - 8 })}
        </g>
      );
    } else if (seg.kind === "feeder_link") {
      const ty = yPx(seg.path[0].y);
      terminals.push({ x: termX, y: ty });
      const pts = [
        { x: x(mainX), y: ty },
        { x: termX, y: ty },
      ];
      drawn.push(
        <g key={seg.key}>
          <PhaseBars seg={seg} pts={pts} hasNeutral={hasNeutral} color={colorOf(seg)} selected={sel} onSelect={select(seg.key)} title={tip(seg)} />
          {tag(seg, { x: (pts[0].x + pts[1].x) / 2, y: ty - 6 })}
        </g>
      );
    }
  }
  for (const seg of droppers) {
    const farY = yPx(seg.path[seg.path.length - 1].y);
    const pts = [
      { x: x(mainX), y: chamberY },
      { x: x(mainX), y: farY },
    ];
    drawn.push(
      <g key={seg.key}>
        <PhaseBars seg={seg} pts={pts} hasNeutral={hasNeutral} color={colorOf(seg)} selected={seg.key === selectedKey} onSelect={select(seg.key)} title={tip(seg)} />
        {tag(seg, { x: x(mainX) - 10, y: (chamberY + farY) / 2 }, "end", 0)}
      </g>
    );
  }

  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" style={{ width: Math.max(widthPx, 1), height: Math.max(heightPx, 1) }}>
      {/* devices (front zone) */}
      {bay.compartments.map((c) => {
        const top = yPx(bay.panelTopMm + c.topMm);
        const h = yPx(bay.panelTopMm + c.topMm + c.heightMm) - top;
        return (
          <g key={c.id}>
            <rect
              x={termX + 2}
              y={top + 1}
              width={Math.max(widthPx - termX - 4, 2)}
              height={Math.max(h - 2, 1)}
              fill={c.isBlank ? "none" : "#f1f5f9"}
              stroke={c.isBlank ? "#cbd5e1" : "#64748b"}
              strokeDasharray={c.isBlank ? "3 2" : undefined}
              strokeWidth={0.8}
            />
            {h >= 9 && (
              <text x={widthPx - 5} y={top + Math.min(h / 2 + 3, 11)} fontSize={7} fontFamily="ui-sans-serif, system-ui" fill={c.isBlank ? "#94a3b8" : "#334155"} textAnchor="end">
                {c.label.length > 22 ? `${c.label.slice(0, 21)}…` : c.label}
              </text>
            )}
          </g>
        );
      })}
      {/* device rear face (terminal plane) */}
      <line x1={termX} y1={0} x2={termX} y2={heightPx} stroke="#94a3b8" strokeWidth={0.6} strokeDasharray="2 3" />
      <text x={termX - 2} y={heightPx - 3} fontSize={6.5} fill="#64748b" textAnchor="end">
        terminals
      </text>
      <text x={widthPx - 3} y={heightPx - 3} fontSize={7} fontWeight={700} fill="#334155" textAnchor="end">
        FRONT →
      </text>
      {drawn}
      {main && (
        <MainCrossSection
          seg={main}
          cx={x(mainX)}
          cy={chamberY}
          maxHeightPx={chamberPx - 4}
          pxPerMm={pxPerMm}
          hasNeutral={hasNeutral}
          selected={main.key === selectedKey}
          onSelect={select(main.key)}
          material={material}
        />
      )}
      {terminals.map((t, i) => (
        <rect key={i} x={t.x - 3} y={t.y - 3} width={6} height={6} fill="#111827" stroke="#ffffff" strokeWidth={0.8}>
          <title>Device terminal</title>
        </rect>
      ))}
      {showBars && (
        <g>
          {(["R", "Y", "B", ...(hasNeutral ? ["N"] : [])] as string[]).map((ph, i) => (
            <g key={ph}>
              <line x1={4} y1={heightPx - 44 + i * 9} x2={14} y2={heightPx - 44 + i * 9} stroke={PHASE_COLOR[ph]} strokeWidth={1.5} />
              <text x={17} y={heightPx - 41 + i * 9} fontSize={7} fill="#334155">
                {ph}
              </text>
            </g>
          ))}
        </g>
      )}
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

// Only the stocked sizes for this material are offered. A bar already set
// to something else (e.g. after the board's material changed) still shows,
// marked, so the select reflects reality -- but can't be chosen again.
function barOptions(material: BusbarMaterial, current: BarSize | null): { bar: BarSize; stocked: boolean }[] {
  const stocked = BAR_SIZES[material].map((bar) => ({ bar, stocked: true }));
  if (!current || isStockedBar(material, current)) return stocked;
  return [...stocked, { bar: current, stocked: false }].sort((a, b) => barArea(a.bar) - barArea(b.bar));
}

type OverridePatch = Partial<Pick<BusbarOverride, "barWidthMm" | "barThicknessMm" | "runsPerPhase" | "lengthMm" | "startExtMm" | "endExtMm">>;

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
            {barOptions(material, segment.bar).map(({ bar: b, stocked }) => (
              <option key={barValue(b)} value={barValue(b)} disabled={!stocked}>
                {b.widthMm} × {b.thicknessMm} ({barArea(b)} mm²){stocked ? "" : " — not stocked"}
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
              onPatch({ lengthMm: null, startExtMm: null, endExtMm: null });
            } else if (n !== segment.lengthMm) {
              onPatch({ lengthMm: n, startExtMm: null, endExtMm: null });
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
  // null = follow the ticked rows: the pickers show the size/runs the
  // first ticked bar currently has, until the user picks something else.
  const [bulkBarChoice, setBulkBarChoice] = useState<string | null>(null);
  const [bulkRunsChoice, setBulkRunsChoice] = useState<number | null>(null);
  const liveChecked = plan.segments.filter((s) => checked.has(s.key));
  const firstChecked = liveChecked[0];
  const bulkBar = bulkBarChoice ?? (firstChecked?.bar ? barValue(firstChecked.bar) : barValue(BAR_SIZES[material][0]));
  const bulkRuns = bulkRunsChoice ?? firstChecked?.runs ?? 1;
  const overriddenKeys = plan.segments.filter((s) => s.overridden.size || s.overridden.runs || s.overridden.length).map((s) => s.key);
  const allChecked = plan.segments.length > 0 && liveChecked.length === plan.segments.length;

  function toggle(key: string) {
    setBulkBarChoice(null);
    setBulkRunsChoice(null);
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
          <select value={bulkBar} onChange={(e) => setBulkBarChoice(e.target.value)} className="rounded bg-surface-container-lowest px-1.5 py-1 text-on-surface">
            {barOptions(material, firstChecked?.bar ?? null).map(({ bar: b, stocked }) => (
              <option key={barValue(b)} value={barValue(b)} disabled={!stocked}>
                {b.widthMm} × {b.thicknessMm}
                {stocked ? "" : " — not stocked"}
              </option>
            ))}
          </select>
          <span className="opacity-60">runs</span>
          <select value={bulkRuns} onChange={(e) => setBulkRunsChoice(Number(e.target.value))} className="rounded bg-surface-container-lowest px-1.5 py-1 text-on-surface">
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
                    onChange={() => {
                      setBulkBarChoice(null);
                      setBulkRunsChoice(null);
                      setChecked(allChecked ? new Set() : new Set(plan.segments.map((s) => s.key)));
                    }}
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
