import type { Face } from "@/types/database";
import type { VerticalWithFeeders } from "@/lib/ga-layout";

// Double-front panels: every bay has a front and a rear face. Bays, the
// busbars and the enclosure are shared; feeders (and the blank / DUMMY
// space) belong to one face. GA Builder edits one face at a time; costing
// reads both.

export const faceOf = (p: { face?: Face | null }): Face =>
  p.face === "rear" ? "rear" : "front";

/** true when any real bay has a feeder on its rear face */
export function hasRearFeeders(verticals: VerticalWithFeeders[]): boolean {
  return verticals.some(
    (v) =>
      v.bay_type !== "unassigned" && v.placed.some((p) => faceOf(p) === "rear"),
  );
}

/**
 * The line-up as seen from one face: each real bay keeps only that face's
 * feeders, and on the rear its blank-space settings come from the rear_*
 * columns. The unassigned bucket keeps every feeder (it has no face).
 */
export function faceView(
  verticals: VerticalWithFeeders[],
  face: Face,
): VerticalWithFeeders[] {
  return verticals.map((v) => {
    if (v.bay_type === "unassigned") return v;
    const placed = v.placed.filter((p) => faceOf(p) === face);
    return face === "rear"
      ? {
          ...v,
          placed,
          dummy_slot: v.rear_dummy_slot ?? null,
          dummy_height_mm: v.rear_dummy_height_mm ?? null,
        }
      : { ...v, placed };
  });
}
