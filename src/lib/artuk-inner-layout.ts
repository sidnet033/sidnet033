import type { BayType } from "@/types/database";

// Inside the ABB "920+1120mm MCC VERTICAL FRONT ACCESS" pair (page 9), from
// the left: 920 bay = 60 | 300 cable alley | 500 feeders | 60;
// 1120 bay = 60 | 250 VBBC (shared vertical busbar) | 450 feeders |
// 300 cable alley | 60. Positions are mm from each bay's left edge.
export type InnerZone = {
  leftMm: number;
  widthMm: number;
  kind: "cable_alley" | "vbb";
  label: string;
};
export type InnerLayout = {
  feederLeftMm: number;
  feederRightMm: number;
  zones: InnerZone[];
};

export function frontAccessPairLayouts(
  bays: {
    id: string;
    bay_type: BayType | null;
    width_mm: number | null;
    depth_mm: number | null;
  }[],
): Map<string, InnerLayout> {
  const out = new Map<string, InnerLayout>();
  const alley = (t: BayType | null) =>
    t === "cable_alley" || t === "busbar_alley" || t === "unassigned";
  const front = (d: number | null) => d != null && d <= 837;
  for (let i = 0; i < bays.length - 1; i++) {
    const a = bays[i];
    const b = bays[i + 1];
    if (out.has(a.id)) continue;
    if (
      a.width_mm === 920 &&
      b.width_mm === 1120 &&
      !alley(a.bay_type) &&
      !alley(b.bay_type) &&
      front(a.depth_mm) &&
      front(b.depth_mm)
    ) {
      out.set(a.id, {
        feederLeftMm: 360,
        feederRightMm: 860,
        zones: [
          {
            leftMm: 60,
            widthMm: 300,
            kind: "cable_alley",
            label: "Cable alley",
          },
        ],
      });
      out.set(b.id, {
        feederLeftMm: 310,
        feederRightMm: 760,
        zones: [
          { leftMm: 60, widthMm: 250, kind: "vbb", label: "VBB (shared)" },
          {
            leftMm: 760,
            widthMm: 300,
            kind: "cable_alley",
            label: "Cable alley",
          },
        ],
      });
    }
  }
  return out;
}
