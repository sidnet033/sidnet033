import type { BusbarMaterial, BusbarPlan, BusbarSegment } from "@/lib/busbar-plan";

// Busbar supports on ArTu-K boards, from ABB's documents:
//  - maximum span between supports by short-circuit rating (busbar
//    selection chart ELSP/ARTU-K/ENGG/BUSBAR CHART/01):
//      ACB boards  Cu: 50kA 350mm, 65kA 325mm, 100kA 275mm
//                  Al: 50kA 450mm, 65kA 380mm
//      MCCB boards Cu: 36kA 425mm, 50kA 350mm, 65kA 325mm
//                  Al: 50kA 450mm, 65kA 380mm
//  - horizontal busbar (HBB) supports per bay as ABB builds its type-tested
//    bays (assembly guideline kit lists and the internal arc guideline
//    ELSP/ARTU-K/ENGG/04): 720w 2, 920w / 1120w 3, 1320w 4. Above 50kA the
//    tighter span can call for more; other widths go by span,
//  - vertical busbars (droppers): by span, minimum 2 (internal arc: 4),
//  - part by runs per phase: 1-2R 551060-T6, 3R 551090-T3, 4R+ 551040-T1A
//    INTL with a neutral support (100% 551040-T1NFA / 50% 551040-T2NHA);
//    bays under 900mm deep (front access) MXM6514NS (1R) / MXM8224NS (2R).
// Positions are front-view mm, the same coordinates as the busbar plan.

export type BusbarSupport = {
  id: string;
  kind: "hbb" | "vbb";
  segmentKey: string;
  bayName: string;
  x: number;
  y: number;
  code: string;
  neutralCode: string | null;
  spanMm: number;
};

export type SupportBay = { id: string; name: string; leftMm: number; widthMm: number; depthMm: number | null };

const HBB_PER_BAY: Record<number, number> = { 720: 2, 920: 3, 1120: 3, 1320: 4 };

export function supportSpanMm(material: BusbarMaterial, ka: number | null, mccbBoard: boolean): { spanMm: number; warnings: string[] } {
  const warnings: string[] = [];
  const k = ka ?? 50;
  if (ka == null) warnings.push("Switchboard kA not set — busbar supports spaced for 50kA.");
  let spanMm: number;
  if (material === "Cu") {
    if (mccbBoard) spanMm = k <= 36 ? 425 : k <= 50 ? 350 : 325;
    else spanMm = k <= 50 ? 350 : k <= 65 ? 325 : 275;
    if (k > (mccbBoard ? 65 : 100)) warnings.push(`${k}kA is above ABB's busbar support chart — check support spacing with ABB.`);
  } else {
    spanMm = k <= 50 ? 450 : 380;
    if (k > 65) warnings.push(`${k}kA is above ABB's aluminium busbar support chart — check support spacing with ABB.`);
  }
  return { spanMm, warnings };
}

function supportParts(seg: BusbarSegment | undefined, depthMm: number | null, poles: number): { code: string; neutralCode: string | null } {
  const runs = seg?.runs ?? 1;
  if (depthMm != null && depthMm < 900) return { code: runs >= 2 ? "MXM8224NS" : "MXM6514NS", neutralCode: null };
  if (runs <= 2) return { code: "551060-T6", neutralCode: null };
  if (runs === 3) return { code: "551090-T3", neutralCode: null };
  const neutralRuns = seg?.neutral?.runs ?? 0;
  return { code: "551040-T1A INTL", neutralCode: poles >= 4 ? (neutralRuns >= runs ? "551040-T1NFA" : "551040-T2NHA") : null };
}

export function planBusbarSupports(args: {
  plan: BusbarPlan | null;
  bays: SupportBay[];
  material: BusbarMaterial;
  ka: number | null;
  mccbBoard: boolean;
  internalArc: boolean;
  poles: number;
}): { supports: BusbarSupport[]; spanMm: number; warnings: string[] } {
  const { plan, bays } = args;
  const { spanMm, warnings } = supportSpanMm(args.material, args.ka, args.mccbBoard);
  const supports: BusbarSupport[] = [];
  if (!plan) return { supports, spanMm, warnings };

  const main = plan.segments.find((s) => s.kind === "main");
  if (main) {
    const y = main.path[0].y;
    for (const bay of bays) {
      if (bay.widthMm <= 0) continue;
      const table = HBB_PER_BAY[bay.widthMm];
      const bySpan = Math.ceil(bay.widthMm / spanMm);
      const n = table != null ? ((args.ka ?? 50) <= 50 ? table : Math.max(table, bySpan)) : Math.max(1, bySpan);
      const parts = supportParts(main, bay.depthMm, args.poles);
      for (let i = 0; i < n; i++) {
        supports.push({
          id: `hbb-${bay.id}-${i}`,
          kind: "hbb",
          segmentKey: main.key,
          bayName: bay.name,
          x: bay.leftMm + (bay.widthMm * (i + 0.5)) / n,
          y,
          ...parts,
          spanMm,
        });
      }
    }
  }

  for (const seg of plan.segments.filter((s) => s.kind === "dropper")) {
    const [a, b] = [seg.path[0], seg.path[seg.path.length - 1]];
    const length = Math.abs(b.y - a.y);
    if (length <= 0) continue;
    const n = Math.max(args.internalArc ? 4 : 2, Math.ceil(length / spanMm));
    const bay = bays.find((v) => a.x >= v.leftMm && a.x <= v.leftMm + v.widthMm);
    const parts = supportParts(seg, bay?.depthMm ?? null, args.poles);
    for (let i = 0; i < n; i++) {
      supports.push({
        id: `vbb-${seg.key}-${i}`,
        kind: "vbb",
        segmentKey: seg.key,
        bayName: bay?.name ?? "",
        x: a.x,
        y: a.y + ((b.y - a.y) * (i + 0.5)) / n,
        ...parts,
        spanMm,
      });
    }
  }
  return { supports, spanMm, warnings };
}
