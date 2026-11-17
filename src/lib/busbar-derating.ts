import { altitudeFactor } from "@/lib/breaker-derating";

// Main busbar (HBB) derating for site conditions. ABB's ArTuK busbar
// charts and current-density sizing are taken as rated at the IEC 61439
// service conditions: up to 40 °C ambient (35 °C 24-hour average) and up
// to 2000 m.
//  - Ambient above 40 °C: a bar's current goes with its temperature rise
//    to the 0.61 power (DIN 43671), with the bar held to 105 °C:
//    k = ((105 - ambient) / (105 - 40)) ^ 0.61  (45 °C: 0.95, 50 °C: 0.90,
//    55 °C: 0.85).
//  - Above 2000 m: thinner air cools less -- ABB's altitude factors for its
//    breakers (3000 m: 98%, 4000 m: 93%, 5000 m: 90%).
// The HBB is then sized for panel rating / k at standard conditions.
export const BUSBAR_REF_AMBIENT_C = 40;
export const BUSBAR_MAX_TEMP_C = 105;
const EXPONENT = 0.61;

export type BusbarDerating = {
  factor: number;
  /** why, e.g. ["ambient 50 °C: 90%"]; empty when none applies */
  reasons: string[];
};

export function busbarDerating(
  ambientC: number | null | undefined,
  altitudeM: number | null | undefined,
): BusbarDerating {
  let factor = 1;
  const reasons: string[] = [];
  if (ambientC != null && ambientC > BUSBAR_REF_AMBIENT_C) {
    const k =
      ambientC >= BUSBAR_MAX_TEMP_C
        ? 0
        : Math.pow(
            (BUSBAR_MAX_TEMP_C - ambientC) /
              (BUSBAR_MAX_TEMP_C - BUSBAR_REF_AMBIENT_C),
            EXPONENT,
          );
    factor *= k;
    reasons.push(`ambient ${ambientC} °C: ${Math.round(k * 100)}%`);
  }
  if (altitudeM != null && altitudeM > 2000) {
    const k = altitudeFactor(altitudeM);
    factor *= k;
    reasons.push(`altitude ${altitudeM} m: ${Math.round(k * 100)}%`);
  }
  return { factor, reasons };
}

// The rating the HBB must have at standard conditions to carry `panelA` on
// site; null when there's no rating or the factor is 0.
export function requiredBusbarRating(
  panelA: number | null,
  d: BusbarDerating,
): number | null {
  if (panelA == null || panelA <= 0 || d.factor <= 0) return null;
  return d.factor >= 1 ? panelA : Math.ceil(panelA / d.factor);
}

// project site conditions (the main busbar is derated for them)
export function siteOf(
  p: { site_ambient_temp_c?: number | null; site_altitude_m?: number | null } | null,
): { ambientC: number | null; altitudeM: number | null } {
  return {
    ambientC: p?.site_ambient_temp_c != null ? Number(p.site_ambient_temp_c) : null,
    altitudeM: p?.site_altitude_m != null ? Number(p.site_altitude_m) : null,
  };
}
